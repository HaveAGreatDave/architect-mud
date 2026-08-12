// Waste Crossing — void-travel, on-foot travel between regions across the void.
//
// Regions are islands. Between them is the VOID — no authored corridor, just a
// generated waste you cross on foot when you can't afford to fly. Strike out from a
// perimeter edge and a deterministic graph of transient rooms is generated, walked
// on foot, and deposits you at a distant region.
//
// Two ways in, one code path (launchCrossing):
//   • Walk off the map — moving in any direction with no authored exit off a tile
//     in a void-region fires the engine's `movement.edge` hook.
//   • `voidwalk [heading]` — the explicit verb, from anywhere in a void-region.
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

import { getLivePlayer, getAllLivePlayers, getAllZones, getZone, getZoneEnemies, getMinimapData, addPlayerToZone, removePlayerFromZone,
  registerTransientZone, removeTransientZone, spawnEnemySync, removeEnemyInstance, propsOf } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { getFlag, setFlag, setFlags, clearFlagsIn } from '../../server/engine/flags.js';
import { OPPOSITE } from '../../server/engine/directions.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { query } from '../../server/models/db.js';
import { getItem } from '../../server/engine/items-cache.js';
import { randomUUID } from 'crypto';
import { loadWindow, getTraces, addTrace, claimTrace } from './traces.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const VOID_MAP = 'map_void'; // non-map_world → flag/map-filtered world iterators skip void rooms

// ── Voids (the region adjacency graph — keyed by region) ──────────────────────
// A void is owned by a whole REGION, keyed by flags.region_id. It is entered ONLY by
// walking off that region's rim — a cardinal step from a boundary tile into a
// coordinate that holds no tile at all (see isMapRim). A void has a shared `trunk` (room count
// before the fork) and `dests` — the adjacent regions it forks toward. Each dest
// carries the fork-exit `dir` (n/s/e/w) that leads to its limb, and an optional
// `length` override (else the total gate→dest length is distance-derived).
//
// A dest also NAMES the region it lands in (`region`), rather than that being read off the
// destination zone at runtime. It is the same fact either way in play, but this table is a graph
// and a graph edge should know its own endpoint: the return-leg check ("is anything reachable also
// leavable?") is about the shape of the table, and reading it out of live world state made it
// depend on which zones happened to be loaded.
export const VOIDS = {
  region_coldwater: {
    origin: 'Coldwater',
    trunk: 4,
    dests: [
      // `length` overrides the distance derivation, and the Reach NEEDS it. The rim and Buzzard
      // Field are only 40 tiles apart in a straight line, so `totalLength` clamped to MIN_ROOMS
      // (5) — which with a trunk of 4 left a limb of ONE room. The braid's whole idea is a shared
      // trunk that forks toward real alternatives, and a fork with a single room behind it is a
      // formality. At 8 the fork sits exactly halfway and there is genuine road on the far side of
      // the choice. (It also sets the haul at ~15 minutes; see the tank note in flight-model.js,
      // which is tuned against the 765 tiles this produces.)
      { key: 'reach',  dest: 'zone_the_reach_870_1958', region: 'region_the_reach', heading: 'The Reach', dir: 'south', length: 8 },
      // TERMINUS. `zone_exodus_waypoint` never existed — this limb deposited walkers at a zone id
      // with no zone behind it. The destination is now the roadhead outside the Exodus wall.
      //
      // `heading` stays 'Exodus' because that is what the fork means: the direction the Exodus
      // went, not a town of that name. The codex is explicit that they will not say where they are
      // going, and Terminus is where they went when they left the Basin, not where they are going.
      //
      // `length: 12` for the same reason the Reach needs 8 — the derivation is straight-line and
      // would clamp to MIN_ROOMS even at 255 tiles out. Twelve rooms puts Terminus beyond the range
      // of the two cheapest trucks and beyond ANY truck's round trip, so the fleet ladder doubles
      // as a map gate and the far yard's fuel pump is the only way home. See
      // docs/proposals/terminus.md.
      { key: 'exodus', dest: 'zone_terminus_1200_916', region: 'region_terminus', heading: 'Exodus', dir: 'east', length: 12 },
    ],
  },

  // ── The way home ───────────────────────────────────────────────────────────
  // Until these existed the void was ONE-WAY. Only Coldwater had an entry, so a walker who
  // reached the Reach — or a trucker who drove to Terminus — could not leave by the road they had
  // just come down: the rim they were standing on was an ordinary wall in that direction. Terminus
  // made it plain, because the Gantry is `vtol_only, charter: false`, so the only way out of the
  // place was a Dragonfly you had to already own. Somebody who spent 31,000 credits on a rig
  // could be stranded by it.
  //
  // These are NOT new roads. Each is the same crossing read backwards — the same `length`, so the
  // corridor is the same distance and the tank maths holds in both directions, and the arrival
  // tile is the rim tile that faces the way you went. A trunk of one keeps a single-destination
  // void honest: there is nothing to fork toward, so the "shared trunk" is a formality and the
  // limb is the crossing. (Detours need `trunkLen >= 3` and therefore do not appear on a return
  // leg — correct: the gamble is a thing you take on the way OUT, with a full tank and a choice
  // still ahead of you.)
  region_the_reach: {
    origin: 'The Reach',
    trunk: 1,
    // North out of the Reach, back onto the dirt road at the foot of the Coldwater map — the one
    // tile on that whole rim that is `dirt_road` rather than redrock, because it is the road.
    dests: [
      { key: 'coldwater', dest: 'zone_district_918_947', region: 'region_coldwater', heading: 'Coldwater', dir: 'north', length: 8 },
    ],
  },
  region_terminus: {
    origin: 'Terminus',
    trunk: 1,
    // West out of Terminus, onto Coldwater's east rim at the same latitude as the Roadhead — you
    // come back in level with where you left.
    dests: [
      { key: 'coldwater', dest: 'zone_district_955_916', region: 'region_coldwater', heading: 'Coldwater', dir: 'west', length: 12 },
    ],
  },
};

const crossings = new Map();
let _seq = 0;

// The whole crossing — trunk length, detour placement, hard nodes, the big score —
// is seeded off (voidKey, window), and the window is the real-world week. That is
// correct in play (everyone this week walks the same waste) and poison in a test:
// the regress suite would walk a DIFFERENT map every Monday, so a green gate could
// go red on a tree nobody touched. WINDOW_FORCE lets the suite pin one week and get
// a deterministic layout. Never set outside regress.
let WINDOW_FORCE = null;
function currentWindow() { return WINDOW_FORCE ?? Math.floor(Date.now() / WEEK_MS); }

export function voidGateOf(zone) {
  const key = zone?.flags?.region_id;
  if (!key || !VOIDS[key]) return null;
  return { key, void: VOIDS[key] };
}
// ── The rim: where the world actually stops ───────────────────────────────────
// The void is entered by walking out of the world, so "off the map" has to mean the
// real thing: no TILE at the neighbouring coordinate. A missing `exits` entry is NOT
// the rim — 483 map_world tiles (building facades, water margins) sit beside a real
// neighbour they simply don't connect to, and bumping those must stay an ordinary
// wall. Cardinals only; up/down/in/out are never the rim.
const RIM_DELTA = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

// Coordinate index over placed tiles, so a rim test is a hash lookup instead of a
// ~5,700-zone scan — describeRim runs on every look, which is a hot path. Transient
// void rooms are coordless and never enter the index. Short TTL so a dev-panel zone
// add self-heals without a restart; the shipped world is static between deploys.
const RIM_INDEX_TTL_MS = 60_000;
let coordIndex = null, coordIndexAt = 0;
function placedCoords() {
  const now = Date.now();
  if (coordIndex && now - coordIndexAt < RIM_INDEX_TTL_MS) return coordIndex;
  const set = new Set();
  for (const z of getAllZones()) {
    if (!z.map_id || z.grid_x == null || z.grid_y == null) continue;
    set.add(`${z.map_id}|${z.grid_z ?? 0}|${z.grid_x},${z.grid_y}`);
  }
  coordIndex = set; coordIndexAt = now;
  return set;
}

function isMapRim(zone, direction) {
  const d = RIM_DELTA[direction];
  if (!d || !zone?.map_id || zone.grid_x == null || zone.grid_y == null) return false;
  // You cross the waste on foot. Open water is not the waste: the entire northern
  // edge of Coldwater (y=896) is basin, and "the ground runs out to the north" is a
  // lie told to someone who is swimming in it. A water tile has no rim in any
  // direction — no line, and no way in. Whatever lies past the far shore is a
  // different system's problem (boats, the leviathan), not the void's.
  if (propsOf(zone.id).liquid) return false;
  return !placedCoords().has(
    `${zone.map_id}|${zone.grid_z ?? 0}|${zone.grid_x + d[0]},${zone.grid_y + d[1]}`);
}

// Which cardinals off this tile lead clean out of the world.
function rimDirs(zone) {
  if (!zone?.map_id || zone.grid_x == null || zone.grid_y == null) return [];
  return Object.keys(RIM_DELTA).filter((dir) => isMapRim(zone, dir));
}

// zone.describeRoom: a boundary tile says so. The rim is the void's only entrance and
// a full muster overlay is a hard thing to meet with no warning, so the edge announces
// itself one step before you can walk off it — and the warning IS the tutorial. Returns
// undefined everywhere else; fireHook keeps the last defined result, so a silent
// non-rim zone never clobbers the airfield/elevator/AA panels.
async function describeRim(zone) {
  if (!zone?.map_id || zone.grid_x == null) return undefined;
  if (!voidGateOf(zone)) return undefined; // a rim with no void behind it promises nothing
  const dirs = rimDirs(zone);
  if (!dirs.length) return undefined;
  const where = dirs.length === 1
    ? `to the ${dirs[0]}`
    : `to the ${dirs.slice(0, -1).join(', ')} and ${dirs[dirs.length - 1]}`;
  return `<span class="ambient">The ground runs out ${where}. There is no horizon that way to read and no distance to judge — only the waste, going on being nothing in particular for as long as you can stand to look at it. People do walk out into it from here. The ones who come back mostly come back somewhere else.</span>`;
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
const HARD_ENCOUNTER_CHANCE = 0.85;  // a seeded hard node reliably bites
const HARD_NODE_CHANCE = 0.22;       // ~1 in 5 spine/limb rooms this window is a hard node
const VOID_FOE_IDS = [
  'enemy_ash_crawler', 'enemy_bloated_mutant', 'enemy_rad_mutant', 'enemy_feral_dog',
  'enemy_wire_jackal', 'enemy_gutter_hound', 'enemy_scav', 'enemy_scrap_picker',
  'enemy_sprawl_ganger', 'enemy_slag_wretch', 'enemy_slag_wight',
];
// The deep-waste menaces — a clear tier above the normal roster (100–130 HP vs a
// 65-HP top-end rad mutant). A hard node fields one of these on top of its pack.
const VOID_HARD_FOE_IDS = ['enemy_arbiterclass_enforcement_unit', 'enemy_redline_horror'];
let FOE_POOL = [];
let HARD_FOE_POOL = [];
let ENCOUNTERS_ON = true; // regress flips this off so movement tests stay deterministic

async function loadFoes() {
  try {
    const { rows } = await query('SELECT * FROM enemies WHERE id = ANY($1)', [[...VOID_FOE_IDS, ...VOID_HARD_FOE_IDS]]);
    const hard = new Set(VOID_HARD_FOE_IDS);
    FOE_POOL = rows.filter(r => !hard.has(r.id));
    HARD_FOE_POOL = rows.filter(r => hard.has(r.id));
  } catch (e) { console.error('[voidwalking] loadFoes:', e.message); }
  return FOE_POOL;
}
// A room is a hard node if its seed says so — deterministic per (void, window, salt),
// so everyone this window meets the same rough stretches (and a scrawl warns the next).
function isHardNode(voidKey, window, salt) {
  return mulberry32(hashSeed(`${voidKey}|${window}|${salt}|hard`))() < HARD_NODE_CHANCE;
}
const ENCOUNTER_LINES = [
  'Something detaches from the haze and comes at you —',
  'A shape you took for a rock uncoils and charges —',
  'Grit scatters as it breaks cover —',
  'You are not alone out here. It was waiting —',
];
const HARD_ENCOUNTER_LINES = [
  'The ground itself seems to give something up —',
  "This is the kind of place people don't walk out of —",
  'Whatever owns this stretch of waste steps into the open —',
];
const MAX_VOID_FOES = 4; // a pack this size is plenty — keeps a big party from a slog
// Scale the pack to the party crossing together: solo/duo → 1, then +1 per pair,
// capped. Sized to the whole crossing, not who's in the room this instant, so
// splitting up costs you the numbers instead of thinning every ambush.
function foesFor(c) {
  return Math.max(1, Math.min(MAX_VOID_FOES, Math.ceil((c.members?.size || 1) / 2)));
}
function spawnFoe(c, roomId) {
  if (!FOE_POOL.length) return null;
  const zone = getZone(roomId);
  if (!zone || zone.enemies.size > 0) return null; // one pack per room — the first arrival spawns it
  const hard = !!zone.flags?.void_hard;
  const n = foesFor(c) + (hard ? 1 : 0); // a hard node pushes the pack one past the cap
  const spawned = [];
  for (let i = 0; i < n; i++) {
    // At a hard node the pack is led by a tougher foe (if the hard roster loaded);
    // the rest are the usual waste vermin.
    const pool = (hard && i === 0 && HARD_FOE_POOL.length) ? HARD_FOE_POOL : FOE_POOL;
    const template = pool[Math.floor(Math.random() * pool.length)];
    const inst = spawnEnemySync(template, roomId);
    c.enemies.add(inst.instanceId);
    spawned.push(inst);
  }
  if (!spawned.length) return null;
  const lines = hard ? HARD_ENCOUNTER_LINES : ENCOUNTER_LINES;
  const line = lines[Math.floor(Math.random() * lines.length)];
  const names = spawned.map(s => `<b>${s.name}</b>`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  sendToZone(roomId, { type: 'zone_event', message: `${line} ${list}.`, refresh: true });
  return spawned[0];
}
// The dead are your map: show any scrawls/corpses left at this room this window.
function showTraces(actor, c, roomId) {
  const salt = getZone(roomId)?.flags?.void_salt;
  if (!salt) return;
  const trunk = VOIDS[c.voidKey].trunk;
  const lines = [];
  if (bigScoreOpen(c.voidKey, c.window, salt, trunk))
    lines.push("The hulk of a downed gunship dominates this stretch — real salvage in it, if it's still here. <b>(loot)</b>");
  for (const t of getTraces(c.voidKey, c.window, salt)) {
    if (t.kind === 'scrawl') lines.push(`Scratched into the ground, four letters: <b>${t.note}</b>`);
    else if (t.kind === 'corpse') lines.push(`A body half-buried in the dust${t.handle ? ` — what's left of <b>${t.handle}</b>` : ''}${t.note ? `, ${t.note.toLowerCase()}` : ''}.${!t.claimed && packItems(t.pack).length ? ' <b>(loot to strip it)</b>' : ''}`);
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
  const hardFlags = (salt) => isHardNode(voidKey, window, salt) ? { void_hard: true } : {};

  // Shared trunk (linear). t0 exits back to the real origin tile. The threshold
  // room (t0) is never a hard node — it's a beat to breathe.
  const trunkLen = Math.max(1, vdef.trunk);
  const trunkId = (i) => `${instanceId}_t${i}`;
  for (let i = 0; i < trunkLen; i++) {
    const exits = { north: i === 0 ? origin : trunkId(i - 1) };
    if (i < trunkLen - 1) exits.south = trunkId(i + 1); // fork's forward exits added below
    registerTransientZone(mkRoom(trunkId(i), voidKey, window, `t${i}`, exits, i >= 1 ? hardFlags(`t${i}`) : {}));
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
      registerTransientZone(mkRoom(limbId(i), voidKey, window, `${d.key}${i}`, exits, hardFlags(`${d.key}${i}`)));
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
  // One DELETE for all five crossing_* flags rather than five serial clearFlags.
  // Goes through the flag store's multi-key funnel so a live player's cached Map
  // is invalidated with it — a raw DELETE here would leave them reading as
  // mid-crossing forever.
  await clearFlagsIn(player, ['crossing_void', 'crossing_window', 'crossing_room', 'crossing_origin', 'crossing_instance'])
    .catch(() => {});
}

// ── Entry (shared by the verb and the walk-off-map hook) ──────────────────────
async function enterMember(m, c, entry, origin) {
  removePlayerFromZone(m.id, m.current_zone);
  addPlayerToZone(m.id, entry.id);
  m.current_zone = entry.id;
  m._crossing = { instanceId: c.id, seen: new Set([entry.id]) };
  c.members.add(m.id);
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [entry.id, m.id]).catch(() => {});
  // One upsert for all five crossing_* flags rather than five serial setFlags
  // (mirror of clearCrossingFlags). Goes through the flag store's multi-key
  // funnel so the live player's cached Map moves with the write.
  await setFlags(m, [
    ['crossing_void', c.voidKey],
    ['crossing_window', c.window],
    ['crossing_origin', origin],
    ['crossing_instance', c.id],
    ['crossing_room', entry.id],
  ]).catch(() => {});
}

// The threshold stamp in the message pane — the one line that marks the moment the
// map ends. Printed to every member the instant they step off the edge.
// Ruled rather than boxed on purpose: no glyph has to line up with a closing edge,
// so it can't break in a proportional font or a narrow pane.
const VOID_ENTRY_BANNER = [
  '',
  '────────────────────────────────────────────',
  '◈  E N T E R I N G   T H E   V O I D',
  'no roads · no rescue · no record of you here',
  '────────────────────────────────────────────',
].join('\n');

export async function launchCrossing(leader, gate, broadcast, heading) {
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
    sendToPlayer(f.id, { type: 'move', message: `${VOID_ENTRY_BANNER}\nYou follow ${leader.handle} out past the edge, into the waste.\n\n${fdesc}`, zone: entry.id, minimap: getMinimapData(entry.id, 8, f) });
  }
  const dests = gate.void.dests.map(d => d.heading).join(' or ');
  const aimLine = aim ? ` You set your heading for ${aim.heading}.` : '';
  const desc = await describeZone(entry, leader);
  return {
    type: 'move',
    message: `${VOID_ENTRY_BANNER}\nYou strike out into the waste. The edge of the map falls away behind you and the road is gone — only the going. Somewhere ahead it splits toward ${dests}.${aimLine}\n\n${desc}`,
    zone: entry.id,
    minimap: getMinimapData(entry.id, 8, leader),
  };
}

// ── The muster (staging + ready-up) ───────────────────────────────────────────
// `voidwalk` (or walking off the edge) doesn't launch immediately — it opens a
// Tablet-OS staging window: your kit, your party, some lore for the road, and a
// ready-check. Everyone in the cohort must `ready` before the crossing launches.
const stagings = new Map();      // stagingId -> { id, leaderId, gate, heading, members:[pid], ready:Set }
const playerStaging = new Map(); // pid -> stagingId

function stagingLore(vdef) {
  const dests = (vdef?.dests || []).map(d => d.heading).join(' or ') || 'the unknown';
  return `Past the wall the map ends and the waste begins — no roads out here, no rescue, no second chance the Architect will pay for. Between you and ${dests} lies trackless killing ground: it shifts with the wind, it buries its own dead, and it does not forgive the unprepared. Check your water. Check your people. When everyone's set, walk off the edge of the known world — and don't look back for whoever falls.`;
}
async function stagingInventory(pid) {
  const { rows } = await query(
    `SELECT i.name AS name, SUM(pi.quantity)::int AS qty
       FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND pi.container_id IS NULL
      GROUP BY i.name ORDER BY i.name`, [pid]
  ).catch(() => ({ rows: [] }));
  return rows.map(r => ({ name: r.name, qty: r.qty }));
}
async function buildStagingPanel(player, staging) {
  const vdef = VOIDS[staging.gate];
  return {
    type: 'voidwalk_staging',
    region: vdef?.origin || 'the frontier',
    dests: (vdef?.dests || []).map(d => d.heading),
    heading: staging.heading || null,
    lore: stagingLore(vdef),
    inventory: await stagingInventory(player.id),
    party: staging.members.map(id => {
      const p = getLivePlayer(id);
      return { handle: p?.handle || 'someone', ready: staging.ready.has(id), you: id === player.id, leader: id === staging.leaderId };
    }),
    youReady: staging.ready.has(player.id),
    allReady: staging.members.every(id => staging.ready.has(id)),
    solo: staging.members.length === 1,
    // Private party comms — history so a re-open / late render restores the log.
    chat: staging.chat.map(c => ({ handle: c.handle, message: c.message, leader: c.pid === staging.leaderId, you: c.pid === player.id })),
  };
}
// Post a line to the muster's private comms and fan it out to every member.
// Ephemeral: lives on the staging object, evaporates when the muster closes.
function stagingChat(player, text) {
  const staging = stagings.get(playerStaging.get(player.id));
  if (!staging) return { type: 'emote', message: "You're not mustering for anything right now." };
  const message = (text || '').trim().slice(0, 300);
  if (!message) return undefined;
  staging.chat.push({ pid: player.id, handle: player.handle, message });
  if (staging.chat.length > 50) staging.chat.shift();
  const leader = player.id === staging.leaderId;
  for (const id of staging.members)
    sendToPlayer(id, { type: 'voidwalk_staging_chat', line: { handle: player.handle, message, leader, you: id === player.id } });
  return undefined;
}
async function openStaging(leader, gate, heading, broadcast) {
  const followers = getAllLivePlayers().filter(p =>
    p.id !== leader.id && p.following === leader.id && p.current_zone === leader.current_zone && !p._crossing && !playerStaging.has(p.id));
  const members = [leader.id, ...followers.map(p => p.id)];
  const staging = { id: `stg_${leader.id}_${++_seq}`, leaderId: leader.id, gate: gate.key, heading, members, ready: new Set(), chat: [] };
  stagings.set(staging.id, staging);
  for (const id of members) playerStaging.set(id, staging.id);
  for (const f of followers) sendToPlayer(f.id, await buildStagingPanel(f, staging));
  if (followers.length && broadcast) broadcast(leader.current_zone, { type: 'zone_event', message: `${leader.handle} musters a party at the edge, weighing the voidwalk.` }, leader.id);
  return buildStagingPanel(leader, staging);
}
function closeStaging(staging) {
  for (const id of staging.members) { playerStaging.delete(id); sendToPlayer(id, { type: 'voidwalk_staging', close: true }); }
  stagings.delete(staging.id);
}
function cancelStaging(player) {
  const staging = stagings.get(playerStaging.get(player.id));
  if (!staging) return { type: 'emote', message: 'You are not mustering for anything.' };
  closeStaging(staging);
  return { type: 'emote', message: 'You step back from the edge. The waste can wait.' };
}
async function launchFromStaging(staging, broadcast) {
  const leader = getLivePlayer(staging.leaderId);
  closeStaging(staging); // close the overlay for everyone; the move payloads render the void behind it
  if (!leader) return null;
  const gate = { key: staging.gate, void: VOIDS[staging.gate] };
  const leaderPanel = await launchCrossing(leader, gate, broadcast, staging.heading);
  sendToPlayer(leader.id, leaderPanel); // followers were already sent their move payloads inside launchCrossing
  return null;
}
async function cmdReady(args, raw, player, broadcast) {
  const staging = stagings.get(playerStaging.get(player.id));
  if (!staging) return { type: 'emote', message: "You're not mustering for anything right now." };
  staging.ready.add(player.id);
  if (staging.members.every(id => staging.ready.has(id))) return launchFromStaging(staging, broadcast);
  for (const id of staging.members) { const p = getLivePlayer(id); if (p) sendToPlayer(id, await buildStagingPanel(p, staging)); }
  return buildStagingPanel(player, staging);
}

// `voidwalk` is no longer an entry point — the void is entered by walking out of the
// world, not by naming it. The verb stays registered because the staging overlay's
// buttons send `voidwalk cancel` / `voidwalk say <text>` (client/game/js/panels/
// voidwalk-staging.js), and because the bare form is the best place to answer the
// player who has heard of the void and is looking for the command.
async function cmdVoidwalk(args, raw, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'cancel') return cancelStaging(player);
  if (sub === 'say') return stagingChat(player, args.slice(1).join(' '));
  const existing = stagings.get(playerStaging.get(player.id));
  if (existing) return buildStagingPanel(player, existing); // already mustering — re-open the window
  if (player._crossing) return { type: 'emote', message: 'You are already out in the waste. The only way through it is through it.' };
  return { type: 'emote', message: 'There is no word for it that works. Nobody steps into the waste by deciding to — they walk, and keep walking, out past the last street and the last fence and the last anything, until there is no next tile to step into. Then they take that step anyway. <span class="text-dim">(pick a direction and hold it until the world runs out)</span>' };
}

async function onMovementEdge({ player, zone, direction, broadcast }) {
  if (player._crossing || playerStaging.has(player.id)) return undefined;
  // You strike out into the waste ON FOOT. Somebody sitting in a vehicle is not on foot, and a
  // muster overlay opening over a cockpit or a truck cab is nonsense — the vehicle has its own way
  // of leaving the map (THE LONG HAUL drives off the rim through `trucksync`). Expressed in
  // POSTURE rather than by asking any particular plugin, so this stays a law about bodies rather
  // than a list of systems: a move gate can't catch it, because the edge hook fires first,
  // before a direction with no exits ever resolves a target for the gates to inspect.
  if (player.posture === 'driving' || player.posture === 'flying') return undefined;
  if (!isMapRim(zone, direction)) return undefined; // an ordinary wall — let the engine report it
  const gate = voidGateOf(zone);
  if (!gate) return undefined; // rim of a region with no void behind it
  return openStaging(player, gate, null, broadcast); // stepping off the rim opens the muster, not the crossing
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
  if (!gate) return { type: 'emote', message: 'You see no way to strike out into the waste from here — this is not a frontier region. (Your charted routes are on the Tablet Frontier map.)' };
  await discoverRoutes(player, gate.key);
  const dests = gate.void.dests.map(d => `<b>${d.heading}</b>`).join(', ');
  return { type: 'output', message: `You read the waste from the edge. Somewhere out there, past the wind, the trail splits toward: ${dests}. (voidwalk, or just walk off the edge — and pray the fork reads true.)` };
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

// ── Forward is earned: a live foe out here blocks the way on ──────────────────
// Encounters aren't optional in the void — you can't stroll past what's stalking you.
// While an enemy stands in your room, the forward exit (`south`, "deeper", the design's
// one advancing direction) is sealed; you can still retreat (`north`) or take a detour.
// Clear the foe (kill it, or it flees) and the way opens.
registerMoveGate(({ player, from, direction }) => {
  if (!player?._crossing) return;
  if (!from?.flags?.void_crossing) return;
  if (direction !== 'south') return; // only the advancing exit is barred; retreat/detour stay open
  if (getZoneEnemies(from.id).length === 0) return;
  return { block: true, message: 'It plants itself between you and the way on — no getting past it until it is down.' };
}, 'voidwalking');

// ── Node tracking + teardown + encounters (every move) ────────────────────────
on('zone.entered', ({ actor, zone }) => {
  try {
    const live = actor?._crossing;
    if (!live) return;
    const c = crossings.get(live.instanceId);
    if (!c) { delete actor._crossing; return; }
    if (c.roomSet.has(zone)) { // a crossing room (trunk / limb / detour)
      showTraces(actor, c, zone);
      const chance = getZone(zone)?.flags?.void_hard ? HARD_ENCOUNTER_CHANCE
        : c.detourSet.has(zone) ? DETOUR_ENCOUNTER_CHANCE : ENCOUNTER_CHANCE;
      maybeEncounter(actor, c, zone, chance);
      return; // crossing_room is RAM (player.current_zone); flushed lazily on logout, not per step
    }
    leaveCrossing(actor, zone); // left the void (arrived at a region, or bailed)
  } catch (e) { console.error('[voidwalking] zone.entered error:', e.message); }
});

// ── RAM reclaim on a clean disconnect (crossing_room already persisted per move) ─
on('player.logout', ({ id }) => {
  try {
    const staging = stagings.get(playerStaging.get(id)); // dropping out of a muster cancels it
    if (staging) closeStaging(staging);
    const player = getLivePlayer(id);
    const live = player?._crossing;
    if (!live) return;
    setFlag('player', 'crossing_room', player.current_zone, player).catch(() => {}); // lazy flush for restart-relog
    const c = crossings.get(live.instanceId);
    delete player._crossing;
    if (c) { c.members.delete(id); if (c.members.size === 0) teardownInstance(c); }
  } catch (e) { console.error('[voidwalking] player.logout error:', e.message); }
});

// ── `salvage` — scavenge a room (Slice 5) ─────────────────────────────────────
// Reuses the Scavenging skill + the 2d8−2d8 check. The waste's loot is generated in
// RAM (no DB scavenge tables — the rooms are transient): a room offers a richness
// tier (detours richer than the spine), and your Scavenging skill decides whether
// you reach the good stuff. Survival staples (water/rations) up top so scavenging
// literally extends your range; salvage/rare deeper. Once per room per crossing.
// Salvage tiers. Entries are `[itemId, maxQty]` — the quantity rolls 1..maxQty, so
// the stackable staples and bulk materials sometimes come up as an actual haul
// instead of a single sad wire.
//
// Deliberately wide (2026-07-21). The first cut was 4/4/3 items with `item_scrap_metal`
// on tier 1 — an item vendors buy for ₵0 — so the reward for crossing a place that
// spawns enemy packs and eats your corpse was frequently nothing at all, and when it
// wasn't, it was the same roadside junk you can scavenge free at the spawn tile.
// The top end is unchanged; this widens the small/medium band, which is where a
// crossing's felt value lives.
const LOOT = {
  // The waste's leavings — small, but a body could live on it.
  1: { diff: 4, items: [
    ['item_water_bottle', 2], ['item_ration', 2], ['item_bar_jerky', 2], ['item_rag_bandage', 2],
    ['item_tangled_wire', 3], ['item_ball_bearings', 2], ['item_salvaged_wadding', 3],
    ['item_steel_plate', 2], ['item_rusty_pipe', 1], ['item_mutated_bone', 2], ['item_duct_tape', 1],
  ] },
  // Proper salvage — worth the weight out, worth real credits back.
  2: { diff: 8, items: [
    ['item_battery', 2], ['item_bandage', 2], ['item_copper_bundle', 2], ['item_scrap_ore', 3],
    ['item_slag_glass', 2], ['item_salvaged_wiring', 3], ['item_depleted_battery', 2],
    ['item_cracked_circuit', 1], ['item_glowing_scrap', 2], ['item_industrial_tape', 1],
    ['item_catalyst_pellets', 1], ['item_pressure_gauge', 1], ['item_valve_assembly', 1],
    ['item_pain_pills', 1], ['item_scrap_shiv', 1], ['item_control_relay', 1],
    ['item_field_splint', 1], ['item_scrap_helmet', 1], ['item_rad_band', 1], ['item_gun_oil_kit', 1],
  ] },
  // What people actually cross for. Kept DELIBERATELY narrow and high — widening this
  // tier with ₵20-ish odds and ends would dilute the scrap-pistol roll, i.e. quietly
  // nerf the payoff for the hardest check while appearing to add rewards.
  3: { diff: 12, items: [
    ['item_scrap_pistol', 1], ['item_buried_strongbox', 1], ['item_mystery_component', 1],
    ['item_copper_nodule', 2], ['item_rad_pills', 2], ['item_busted_datapad', 1],
  ] },
};
// A dig this close still turns something up. The waste is generous with rubbish and
// stingy with everything else, and a flat miss is a dead 3.5s in a room that can kill you.
const NEAR_MISS = -4;
const rollEntry = (t) => t.items[Math.floor(Math.random() * t.items.length)];
const rollQty = (maxQty = 1) => 1 + Math.floor(Math.random() * maxQty);
let SALVAGE_FORCE = null; // regress override: null → real roll, 0/1 → forced fail/success
function roll2d8() { return Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1; }
function packItems(pack) {
  if (Array.isArray(pack)) return pack;
  if (typeof pack === 'string') { try { return JSON.parse(pack) || []; } catch { return []; } }
  return pack || [];
}

// The weekly "big score" (Slice 5b): one telegraphed prize per (void, window), at a
// seeded shared-trunk room, kept globally scarce by a claim trace — first crosser to
// loot it takes it (the async race). Everyone this window sees the same wreck at the
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

async function grantItem(playerId, itemId, qty = 1) {
  await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, condition) VALUES ($1,$2,$3,$4,1.0)', [randomUUID(), playerId, itemId, qty]).catch(() => {});
  const name = getItem(itemId)?.name || 'a piece of salvage'; // name lives in the RAM items cache — no need to re-query per grant
  return qty > 1 ? `${qty}× ${name}` : name;
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
  } catch (e) { console.error('[voidwalking] captureCorpsePack:', e.message); return []; }
}

async function cmdLoot(args, raw, player, broadcast) {
  const live = player._crossing;
  const c = live && crossings.get(live.instanceId);
  // `loot` is the engine's corpse-looting verb. Only bare `loot` mid-crossing is
  // void salvage; anything else falls through so corpse looting still works.
  if (!c || args.length) return undefined;
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
  const [itemId, maxQty] = rollEntry(table);

  const effective = await effectiveSkill(player, 'scavenging');
  const margin = (effective - table.diff) + (roll2d8() - roll2d8());
  await awardSkillUse(player.id, 'scavenging', margin).catch(() => {}); // a near-miss still trains you
  const forced = SALVAGE_FORCE != null;                                // regress override: a hard pass/fail, no consolation
  const success = forced ? !!SALVAGE_FORCE : margin >= 0;
  if (!success) {
    if (!forced && margin >= NEAR_MISS) {
      const [scrapId, scrapMax] = rollEntry(LOOT[1]);
      const scrap = await grantItem(player.id, scrapId, rollQty(scrapMax));
      return { type: 'emote', message: `<span class="item-grant">Nothing in here worth the name — but you turn up ${scrap} on your way back out.</span>` };
    }
    return { type: 'emote', message: `You dig through the ${isDetour ? 'wreckage' : 'dust'} and come up with nothing but grit and disappointment.` };
  }

  const name = await grantItem(player.id, itemId, rollQty(maxQty));
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
  } catch (e) { console.error('[voidwalking] player.death error:', e.message); }
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
  } catch (e) { console.error('[voidwalking] player.login error:', e.message); }
});

// ── Public surface for other systems ─────────────────────────────────────────
// A crossing is walked room-by-room, so nothing here ever needed to know the ORDER of the chain —
// you just took the exit in front of you. Driving it does: THE LONG HAUL (plugins/trucking) turns
// an odometer reading into "which room am I standing in", which means it needs the spine as an
// ordered list. It is exported here rather than reconstructed there, because reconstructing it
// means copying this file's room-id naming, and the day that naming changes the truck would
// silently deliver people to rooms that no longer exist.
//
// Returns the trunk followed by one destination's limb: index 0 is the threshold room, the last
// index is the room whose `south` exit is the destination region itself.
export function crossingChain(instanceId, destKey) {
  const c = crossings.get(instanceId);
  if (!c) return [];
  const trunk = [], limb = [];
  for (const id of c.roomSet) {
    if (c.detourSet.has(id)) continue;                      // detours hang off the spine, they aren't on it
    const rest = id.slice(instanceId.length + 1);           // strip the `<instanceId>_` namespace
    const m = /^t(\d+)$/.exec(rest);
    if (m) { trunk[+m[1]] = id; continue; }
    const lm = new RegExp(`^${destKey}(\\d+)$`).exec(rest);
    if (lm) limb[+lm[1]] = id;
  }
  return [...trunk, ...limb].filter(Boolean);
}
// The destination zone a limb ends at — where the road comes out.
export function crossingDest(instanceId, destKey) {
  const c = crossings.get(instanceId);
  return c?.dests?.find(d => d.key === destKey)?.dest || null;
}
// What a caller needs to lay something over a crossing without reaching into `crossings`.
// `player._crossing` deliberately carries only { instanceId, seen } — everything else about the
// crossing is shared state and belongs here, not copied onto each member.
export function crossingInfo(instanceId) {
  const c = crossings.get(instanceId);
  if (!c) return null;
  // `trunk` is the number of SHARED rooms before the fork. A walker never needed it — they take
  // an exit and the world decides — but anything laying its own geometry over the crossing does:
  // it is the boundary between the road everybody drives and the limb you chose. (THE LONG HAUL.)
  return { voidKey: c.voidKey, window: c.window, origin: c.origin, entry: c.entry, dests: c.dests,
    trunk: Math.max(1, VOIDS[c.voidKey]?.trunk || 1) };
}

export const commands = {
  voidwalk: cmdVoidwalk,
  ready: cmdReady,
  scrawl: cmdScrawl,
  loot: cmdLoot,
  frontier: cmdFrontier,
};

export const hooks = {
  'movement.edge': onMovementEdge,
  'zone.describeRoom': describeRim,
};

export const _test = {
  crossings, VOIDS, totalLength, TILES_PER_ROOM, MIN_ROOMS, MAX_ROOMS,
  loadFoes, spawnFoe, foesFor, MAX_VOID_FOES, isHardNode, hardFoePool: () => HARD_FOE_POOL, teardownInstance, LOOT, bigScoreSalt, handleDeath: onVoidDeath, frontierView, markSurvived,
  stagings, playerStaging, isMapRim, rimDirs, describeRim,
  foePool: () => FOE_POOL,
  invalidateRimIndex: () => { coordIndex = null; },
  setEncounters: (on) => { ENCOUNTERS_ON = on; },
  setSalvage: (v) => { SALVAGE_FORCE = v; },
  setWindow: (w) => { WINDOW_FORCE = w; },
  currentWindow,
};

loadFoes(); // warm the void roster from the enemies table (one boot query)

console.log('[voidwalking] Plugin loaded.');
