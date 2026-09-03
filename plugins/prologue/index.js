/**
 * Prologue — the pre-world tutorial (zone_the_inbetween → … → zone_the_collapse).
 *
 * New souls spawn into The Inbetween (see server/api/routes.js apiRegister) and
 * walk a one-way corridor of scripted rooms that (1) run chargen through the
 * existing (free) MORPHEX terminal, (2) at the holosign grant a permanent +1 to
 * every attribute — off the XP books — plus a first Architect Interface point and
 * the X-90 holocaster, and (3) close with an eerie broadcast before collapsing
 * them into the Coldwater clone vat (zone_start), their respawn point forever after.
 *
 * Everything here is content-driven and self-contained:
 *   - move gates hard-gate the three narrative doors (alignment, the holocaster,
 *     the finished broadcast);
 *   - the lightless void-rooms are seen ("there is no light, but you can see")
 *     via the engine's zones.flags.always_lit property — no lighting content;
 *   - `use holosign` grants +1 to every stat (via gifted_stat_points, so it costs
 *     no XP) + a first point of Architect Interface IP (interfacing IS the skill) +
 *     the X-90 holocaster; `use holocaster` opens the broadcast door and is
 *     consumed; sitting in The Broadcast drops the kit.
 *
 * No engine files are imported in reverse; the only engine touch-points are the
 * generic seams (move gates, events, flags, specialized `use`, the no_attack NPC
 * flag on the attendant, and cosmetic-machine's appearance.changed event).
 */
import { randomUUID } from 'crypto';
import { loggedPanelsSync } from '../../server/engine/presentation.js';
import { query } from '../../server/models/db.js';
import { on } from '../../server/engine/events.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { sendToPlayer, teachVerb, pointAt, beaconOn, beaconOff, beaconClear } from '../../server/engine/messaging.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { maxHpForEndurance, invalidateSkillCache } from '../../server/engine/ip.js';
import { registerAction } from '../../server/engine/actions.js';
import { getZone, getMinimapData, getLivePlayer, getAllZones, buildingEntranceDir } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { cmdExamine } from '../../server/engine/commands/world.js';
import { escAttr } from '../../server/engine/text.js';

const Z_INBETWEEN = 'zone_the_inbetween';
const Z_LATTICE   = 'zone_the_lattice';
const Z_BROADCAST = 'zone_the_broadcast';
const Z_COLLAPSE  = 'zone_the_collapse';
const Z_CLONEVAT  = 'zone_start';
const PROLOGUE_ZONES = new Set([Z_INBETWEEN, Z_LATTICE, Z_BROADCAST, Z_COLLAPSE]);

const ITEM_HOLOCASTER = 'item_x90_holocaster';

// The Broadcast-room starter kit — the ONLY starting gear (registration hands out
// nothing). Order = drop order. Names must match the items rows so the take-links
// and the look refresh resolve.
const KIT = [
  { id: 'item_bat',             name: 'aluminum bat',      qty: 1 },
  { id: 'item_football_helmet', name: 'football helmet',   qty: 1 },
  { id: 'item_credit_chip',     name: 'credit chip',       qty: 1, credits: 100 },
  { id: 'item_ration',          name: 'vacuum ration',     qty: 5 },
  { id: 'canteen',              name: 'canteen',           qty: 1 },
];

// Flags (player scope, string values via the flag store).
const F_ALIGNED     = 'prologue_aligned';        // chargen applied at the terminal
const F_INTERFACED  = 'prologue_interfaced';     // touched the holosign (first IP + kit)
const F_BROADCAST   = 'prologue_broadcast_open';  // holocaster used → broadcast door open
const F_PLAYED      = 'prologue_broadcast_played';// welcome script has run
const F_COLLAPSE    = 'prologue_collapse_open';   // broadcast finished → collapse door open

const isSet = async (player, flag) => (await getFlag('player', flag, player)) === 'true';
const raise = (player, flag) => setFlag('player', flag, 'true', player);
const out   = (player, message) => sendToPlayer(player.id, { type: 'output', message });

async function grantItem(player, itemId, quantity = 1, owner = player.id, customData = null) {
  await query(
    'INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data) VALUES ($1,$2,$3,$4,1.0,$5)',
    [randomUUID(), owner, itemId, quantity, customData ? JSON.stringify(customData) : null]
  );
}

// The holosign's gift: a permanent +1 to every attribute, FREE of the XP economy.
// The +1s land on the stat columns (so combat/skills/carry all see them), and
// gifted_stat_points records them so statSpent() refunds their cost — the boost
// touches neither Net nor Total XP. Endurance +1 also lifts the HP cap by 2.
async function grantAllStatsPlusOne(player) {
  // Guard the players-row FK / the regress harness's in-memory player.
  const { rows } = await query('SELECT stat_endurance, hp FROM players WHERE id=$1', [player.id]);
  if (!rows.length) return;
  await query(`UPDATE players SET
      stat_brawn = stat_brawn + 1, stat_reflexes = stat_reflexes + 1,
      stat_endurance = stat_endurance + 1, stat_brains = stat_brains + 1,
      stat_cool = stat_cool + 1, stat_senses = stat_senses + 1,
      gifted_stat_points = COALESCE(gifted_stat_points, 0) + 6
    WHERE id = $1`, [player.id]);
  const newHpMax = maxHpForEndurance((Number(rows[0].stat_endurance) || 0) + 1);
  await query('UPDATE players SET hp_max = $1, hp = LEAST(COALESCE(hp, 0) + 2, $1) WHERE id = $2', [newHpMax, player.id]);
  // Mirror onto the live player so combat/skills read the boost immediately, and
  // push the HP cap change to the HUD.
  for (const s of ['brawn', 'reflexes', 'endurance', 'brains', 'cool', 'senses']) {
    player[`stat_${s}`] = (Number(player[`stat_${s}`]) || 0) + 1;
  }
  player.gifted_stat_points = (Number(player.gifted_stat_points) || 0) + 6;
  player.hp_max = newHpMax;
  player.hp = Math.min((Number(player.hp) || newHpMax) + 2, newHpMax);
  sendToPlayer(player.id, { type: 'player_update', hp: player.hp, hp_max: player.hp_max });
}

// Touching the holosign IS an act of Architect Interface — so the touch itself
// teaches the skill. Grant a deterministic first point of IP (the normal use-path
// award is probabilistic; this one moment is guaranteed), demonstrating live that
// skills climb by use. Guarded by the players-row FK for the regress fake player.
async function grantArchitectInterfaceIp(player) {
  const { rowCount } = await query(
    `INSERT INTO player_skills (player_id, skill_id, ip) VALUES ($1, 'architect_interface', 1)
       ON CONFLICT (player_id, skill_id) DO UPDATE SET ip = player_skills.ip + 1`,
    [player.id]
  ).catch(() => ({ rowCount: 0 }));
  // Direct player_skills write behind ip.js's per-player cache — bust it.
  invalidateSkillCache(player.id);
  return rowCount > 0;
}

// ── The skyline the cold open flies through ──────────────────────────────────
//
// The cinematic's last twenty seconds are a flythrough of COLDWATER — not a
// procedural stand-in for it, the actual city, the same footprints and floor
// counts the flight sim extrudes out of a cockpit windshield. Which means the
// client needs the building tiles, and it needs them before it has any world
// state at all (this is a player's first login; they haven't even got a body
// yet, let alone an aircraft, and `mapWindow` only ships to someone in a seat).
//
// So the manifest rides along on the `intro_cinematic` push. It's built once
// from the already-in-memory zone Maps — no query, no tick, no DB read on a
// login path — and cached forever after, because world geometry doesn't move.
//
// Deliberately NOT the flight sim's cell shape: this is a handful of fields per
// building, not a 73×73 window of terrain, roads and scatter. ~70 buildings,
// a few KB on the wire.
//
// `n` (building name) and `e` (entrance side) were added when the cold open started
// drawing real building SHAPES rather than plain boxes. Both are load-bearing and
// neither is derivable client-side: the name is how a landmark resolves to its own
// model (Halcyon's helical slab rather than the generic office box), and the entrance
// is the frame every model's geometry is laid out in — without it a portico, a loading
// bay or a marquee faces an arbitrary direction. See client/shared/building-shapes.js.
let _skyline = null;
function coldwaterSkyline() {
  if (_skyline) return _skyline;
  const out = [];
  try {
    for (const z of getAllZones()) {
      if (z.map_id !== 'map_world') continue;
      const bt = z.flags?.building_type;
      if (!bt) continue;
      // Coldwater only. The Reach's four buildings sit ~70 tiles south and would
      // otherwise stretch the flythrough over an ocean of nothing. Region is
      // `flags.region_id` per docs/reference/land-taxonomy.md; the grid_y bound
      // is the belt for tiles authored before regions existed.
      const region = z.flags?.region_id;
      if (region && region !== 'region_coldwater') continue;
      if (z.grid_y > 960) continue;
      out.push({
        x: z.grid_x, y: z.grid_y, t: bt, f: Number(z.flags?.floors) || 0,
        n: z.flags?.building_name || undefined,
        e: buildingEntranceDir(z) || undefined,
      });
    }
  } catch (e) {
    console.error('[prologue] skyline build failed:', e.message);
  }
  _skyline = out;
  return out;
}

// ── The coastline ────────────────────────────────────────────────────────────
// The cold open traces where land meets water before a single building lands on
// it — the Basin drawn as an outline first, the way a plan is drawn before a
// city is. Sending all 945 water tiles would be silly; sending the BOUNDARY is
// the whole feature and a tenth of the bytes.
//
// A shoreline segment is a tile EDGE shared by a water tile and an authored land
// tile (an unauthored neighbour is the void, not a coast, so it contributes
// nothing). Collinear segments are then merged into runs, which cuts ~309 edges
// down to ~157 runs — about 2 KB. Runs are `[x, y, dir, len]` in tile-CORNER
// coords, `dir` 0 = the run travels +x, 1 = +y.
let _shore = null;
function coldwaterShore() {
  if (_shore) return _shore;
  const runs = [];
  try {
    const terrain = new Map();
    for (const z of getAllZones()) {
      if (z.map_id !== 'map_world') continue;
      terrain.set(`${z.grid_x},${z.grid_y}`, z.flags?.terrain || '');
    }
    const isWater = (x, y) => terrain.get(`${x},${y}`) === 'water';
    const isLand = (x, y) => { const t = terrain.get(`${x},${y}`); return t !== undefined && t !== 'water'; };
    // Two edge sets, keyed by the corner the edge starts at, so a shared edge is
    // recorded once no matter which side we walked in from.
    const horiz = new Set(), vert = new Set();
    for (const key of terrain.keys()) {
      const [x, y] = key.split(',').map(Number);
      if (!isWater(x, y)) continue;
      if (isLand(x, y - 1)) horiz.add(`${x},${y}`);
      if (isLand(x, y + 1)) horiz.add(`${x},${y + 1}`);
      if (isLand(x - 1, y)) vert.add(`${x},${y}`);
      if (isLand(x + 1, y)) vert.add(`${x + 1},${y}`);
    }
    for (const [set, dir] of [[horiz, 0], [vert, 1]]) {
      const used = new Set();
      for (const key of [...set].sort()) {
        if (used.has(key)) continue;
        const [x, y] = key.split(',').map(Number);
        let n = 0, k = key;
        while (set.has(k) && !used.has(k)) { used.add(k); n++; k = dir ? `${x},${y + n}` : `${x + n},${y}`; }
        runs.push([x, y, dir, n]);
      }
    }
  } catch (e) {
    console.error('[prologue] shore build failed:', e.message);
  }
  _shore = runs;
  return runs;
}

// ── The prologue's sound kit ─────────────────────────────────────────────────
// Inline synth defs, sent as ordinary `audio_sfx` pushes (same wire shape and the
// same client generator the clone-vat sequence uses in plugins/audio). They live
// here rather than in the audio plugin because nothing else in the game will ever
// play them — the prologue runs exactly once per soul.
const SFX = {
  // The lattice answering a hand pushed into it: a rising swell that resolves to a chord.
  latticeTouch: {
    id: 'sfx_prologue_lattice', name: 'sfx_prologue_lattice', category: 'sfx', priority: 9,
    config: { duration: 2.4, layers: [
      { waveform: 'sine', freq: 55, pitchBend: { to: 110, time: 1.8 }, adsr: { a: 0.25, d: 0.5, s: 0.6, r: 0.9 }, gain: 0.35 },
      { waveform: 'triangle', freq: 330, adsr: { a: 0.4, d: 0.4, s: 0.5, r: 1.2 }, gain: 0.22 },
      { noiseMix: 0.7, filter: { type: 'bandpass', freq: 2600, q: 1.4 }, adsr: { a: 0.3, d: 0.7, s: 0.3, r: 1.0 }, gain: 0.14 },
    ] },
  },
  // The gift landing: a clean high chime, the "you have been given something" note.
  grant: {
    id: 'sfx_prologue_grant', name: 'sfx_prologue_grant', category: 'sfx', priority: 9,
    config: { duration: 1.4, layers: [
      { waveform: 'triangle', freq: 659.25, adsr: { a: 0.002, d: 0.12, s: 0.5, r: 1.1 }, gain: 0.5 },
      { waveform: 'sine', freq: 987.77, adsr: { a: 0.001, d: 0.09, s: 0.3, r: 1.2 }, gain: 0.28 },
      { waveform: 'sine', freq: 1318.5, adsr: { a: 0.001, d: 0.06, s: 0.15, r: 1.3 }, gain: 0.12 },
    ] },
  },
  // The X-90's stud going down: a tight mechanical click with a hollow tail.
  casterClick: {
    id: 'sfx_prologue_click', name: 'sfx_prologue_click', category: 'sfx', priority: 9,
    config: { duration: 0.35, layers: [
      { noiseMix: 1, filter: { type: 'highpass', freq: 2400, q: 1 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.04 }, gain: 0.7 },
      { waveform: 'square', freq: 180, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.18 }, gain: 0.25 },
    ] },
  },
  // The seam splitting: a sub-heavy tear that pitches DOWN as the wedge comes apart.
  casterSplit: {
    id: 'sfx_prologue_split', name: 'sfx_prologue_split', category: 'sfx', priority: 10,
    config: { duration: 1.8, layers: [
      { waveform: 'sawtooth', freq: 240, pitchBend: { to: 38, time: 1.5 }, filter: { type: 'lowpass', freq: 1600, q: 2 }, adsr: { a: 0.01, d: 0.4, s: 0.5, r: 0.8 }, gain: 0.45 },
      { noiseMix: 1, filter: { type: 'bandpass', freq: 3200, q: 0.8 }, adsr: { a: 0.005, d: 0.5, s: 0.3, r: 0.9 }, gain: 0.35 },
      { waveform: 'sine', freq: 33, adsr: { a: 0.02, d: 0.6, s: 0.6, r: 1.0 }, gain: 0.4 },
    ] },
  },
  // Light unspooling northward and knitting into a doorway: a long shimmering rise.
  doorway: {
    id: 'sfx_prologue_doorway', name: 'sfx_prologue_doorway', category: 'sfx', priority: 10,
    config: { duration: 3.2, layers: [
      { waveform: 'sine', freq: 90, pitchBend: { to: 360, time: 2.6 }, adsr: { a: 0.5, d: 0.6, s: 0.7, r: 1.4 }, gain: 0.3 },
      { noiseMix: 0.9, filter: { type: 'bandpass', freq: 1400, q: 0.6 }, tremolo: { rate: 9, depth: 0.5 }, adsr: { a: 0.6, d: 0.8, s: 0.5, r: 1.6 }, gain: 0.2 },
      { waveform: 'triangle', freq: 880, adsr: { a: 1.2, d: 0.5, s: 0.4, r: 1.5 }, gain: 0.16 },
    ] },
  },
  // ── The Architect's address ────────────────────────────────────────────────
  // The welcome ran in SILENCE until now, which made the one moment the game's
  // author-figure speaks to you directly the quietest in the prologue. These four
  // are deliberately the lowest-pitched things in the game: the bed sits at A0,
  // an octave under the vat swell, because the Architect should be felt in the
  // chest before it is understood in the ear. Nothing here is bright — no chime,
  // no shimmer, no high partial above 1.4k. It is a large machine talking.

  // The wall becoming a screen: a sub swell that arrives before the light does.
  screenWake: {
    id: 'sfx_prologue_screen_wake', name: 'sfx_prologue_screen_wake', category: 'sfx', priority: 10,
    config: { duration: 2.8, layers: [
      { waveform: 'sine', freq: 18, pitchBend: { to: 34, time: 2.2 }, adsr: { a: 0.6, d: 0.8, s: 0.7, r: 1.2 }, gain: 0.6 },
      { waveform: 'sawtooth', freq: 32, pitchBend: { to: 55, time: 2.0 }, filter: { type: 'lowpass', freq: 420, q: 1.4 }, adsr: { a: 0.5, d: 0.9, s: 0.5, r: 1.1 }, gain: 0.3 },
      // The only voice above the sub: glass taking a charge, kept quiet and dull.
      { noiseMix: 1, filter: { type: 'bandpass', freq: 1200, q: 0.9 }, adsr: { a: 0.35, d: 0.7, s: 0.25, r: 0.9 }, gain: 0.1 },
    ] },
  },
  // The room tone that holds under the whole address. A LOOP, so it can be swelled
  // line by line — the address gets heavier as it goes rather than opening at full
  // weight, which is what makes the last line land.
  voiceBed: {
    id: 'sfx_prologue_architect_bed', name: 'sfx_prologue_architect_bed', category: 'ambient', priority: 8,
    config: { gain: 1, layers: [
      { waveform: 'sine', freq: 27.5, adsr: { a: 2.5, d: 1.0, s: 1, r: 2.5 }, gain: 0.5 },
      { waveform: 'sawtooth', freq: 36.71, filter: { type: 'lowpass', freq: 140, q: 0.8 }, adsr: { a: 3.0, d: 1.0, s: 1, r: 2.5 }, gain: 0.34 },
      // Slow breath rather than a steady tone — a room that is doing something.
      { noiseMix: 1, filter: { type: 'lowpass', freq: 220, q: 0.7 }, tremolo: { rate: 0.09, depth: 0.4 }, adsr: { a: 4.0, d: 1.0, s: 1, r: 3.0 }, gain: 0.22 },
    ] },
  },
  // One per spoken line: the weight behind a sentence, not a word-sync. Sub thump
  // with a dead-dull noise brush and no attack transient — it should read as the
  // room pressing rather than as a drum.
  voiceLine: {
    id: 'sfx_prologue_architect_line', name: 'sfx_prologue_architect_line', category: 'sfx', priority: 9,
    config: { duration: 1.8, layers: [
      { waveform: 'sine', freq: 30, adsr: { a: 0.04, d: 0.5, s: 0.35, r: 1.0 }, gain: 0.55 },
      { waveform: 'triangle', freq: 45, adsr: { a: 0.06, d: 0.4, s: 0.25, r: 0.9 }, gain: 0.24 },
      { noiseMix: 1, filter: { type: 'lowpass', freq: 300, q: 1.2 }, adsr: { a: 0.02, d: 0.3, s: 0.1, r: 0.6 }, gain: 0.18 },
    ] },
  },
  // The screen taking the wall with it: everything pitches DOWN and keeps going
  // after the text has stopped, so the dark it leaves is louder than the light was.
  screenDeath: {
    id: 'sfx_prologue_screen_death', name: 'sfx_prologue_screen_death', category: 'sfx', priority: 10,
    config: { duration: 3.6, layers: [
      { waveform: 'sawtooth', freq: 140, pitchBend: { to: 19, time: 2.4 }, filter: { type: 'lowpass', freq: 900, q: 1.6 }, adsr: { a: 0.02, d: 0.6, s: 0.5, r: 1.4 }, gain: 0.42 },
      { waveform: 'sine', freq: 44, pitchBend: { to: 21, time: 2.8 }, adsr: { a: 0.05, d: 0.8, s: 0.6, r: 1.8 }, gain: 0.6 },
      { noiseMix: 1, filter: { type: 'lowpass', freq: 400, q: 0.8 }, adsr: { a: 0.01, d: 0.9, s: 0.2, r: 1.2 }, gain: 0.22 },
    ] },
  },
};

const playSfx = (player, def, gain = 1) =>
  sendToPlayer(player.id, { type: 'audio_sfx', def, gain });

// Loops, for the one sequence that needs a bed under it rather than a cue on top.
// Same fire-and-forget shape as playSfx — the client owns the voice from here.
const startLoop = (player, def) =>
  sendToPlayer(player.id, { type: 'audio_ambience', def });
const rideLoop = (player, id, gain, ramp = 1.2) =>
  sendToPlayer(player.id, { type: 'audio_loop_gain', id, gain, ramp });
const stopLoop = (player, id) =>
  sendToPlayer(player.id, { type: 'audio_stop', scope: 'ambience', id });

// Run a [{ at, def, gain }] cue sheet on the player's own timers. Deliberately a
// plain setTimeout ladder (same shape as playBroadcast below and the clone-vat
// sequence): a handful of one-shots per soul, no tick, no scheduler row.
function playSoundscript(player, cues) {
  for (const { at, def, gain } of cues) setTimeout(() => playSfx(player, def, gain), at);
}

// ── Beacons: whatever the prologue currently wants you to touch, shimmers ─────
// The prologue's one job is that a brand-new player is never stuck wondering what
// to do next. Prose scrolls away; a beacon doesn't.
//
// ONE THING AT A TIME. A beacon is a highlight, not a strobe: light the single
// object this step is steering you toward and nothing else, and put it out the
// moment that step is done. Two shimmering things at once is worse than none —
// it stops reading as "this one" and starts reading as decoration. So the
// attendant shimmers until you talk to him and not a second longer; the terminal
// doesn't shimmer until he's actually told you what it's for (the "How will
// others see me?" line, via the PROLOGUE_BEACON action on that dialogue node);
// and it goes dark the instant you've used it.
//
// The live set is tracked in memory on the player (a UI hint, never persisted)
// so switching steps can turn the previous step's beacons off without knowing
// what they were.
const B_ATTENDANT = ['talk', 'chrome attendant'];
const B_TERMINAL  = ['examine', 'MORPHEX 9000 BioSculpt terminal'];
const B_HOLOSIGN  = ['examine', 'floating holosign'];
const B_CHAIR     = ['examine', 'metal chair'];
const B_NORTH     = ['go', 'north'];

function setBeacons(player, list) {
  if (!player?.id) return;
  const next = list || [];
  const key = ([a, t]) => `${a}|${t}`;
  const prev = player._prologueBeacons || [];
  const keep = new Set(next.map(key));
  for (const b of prev) if (!keep.has(key(b))) beaconOff(player.id, b[0], b[1]);
  for (const b of next) beaconOn(player.id, b[0], b[1]);
  player._prologueBeacons = next;
}

// The dialogue seam. The attendant's tree drives the first two beacons itself:
// `root` (landed on the moment you talk to him) puts HIS shimmer out, and the
// "How will others see me?" node lights the terminal — so the terminal starts
// glowing exactly when the fiction has explained what it's for, not before.
// Authored flat on the node (`{"action":"PROLOGUE_BEACON","at":"terminal"}`),
// which is the shape the VINE dialogue editor writes.
const BEACON_TARGETS = { terminal: [B_TERMINAL], attendant: [B_ATTENDANT], north: [B_NORTH], none: [] };
registerAction({
  type: 'PROLOGUE_BEACON',
  handler: async ({ actor, params }) => {
    const at = String(params?.at || params?.target || 'none').toLowerCase();
    const list = BEACON_TARGETS[at];
    if (!list) return { type: 'error', message: `PROLOGUE_BEACON: unknown target "${at}"` };
    // Never re-light something the player is already past — a replayed dialogue
    // shouldn't put the terminal back on for someone who used it an hour ago.
    if (at === 'terminal' && await isSet(actor, F_ALIGNED)) return { type: 'ok' };
    setBeacons(actor, list);
    return { type: 'ok' };
  },
});

// ── Move gates: the three narrative doors ────────────────────────────────────
// Pure checks; a blocked move returns its in-fiction refusal. Non-prologue moves
// short-circuit before any DB read.
async function prologueMoveGate({ player, to }) {
  if (!to || !PROLOGUE_ZONES.has(to.id)) return undefined;

  // Each refusal re-lights the beacon for the thing that would unblock it — a
  // player who walked into the wall gets the answer pointed at, not just denied.
  if (to.id === Z_LATTICE && !(await isSet(player, F_ALIGNED))) {
    setBeacons(player, [B_TERMINAL]);
    return { block: true, message: `The way north will not open. The attendant does not move. "First, be certain of your shape," it says. "Use the terminal. Tell it what you are." <span class="hint">(try: ${teachVerb('use', 'use', 'MORPHEX 9000 BioSculpt terminal')} — or click the shimmering terminal)</span>` };
  }
  if (to.id === Z_BROADCAST && !(await isSet(player, F_BROADCAST))) {
    return { block: true, message: `There is no door here yet. Only lattice, waiting for you to make one. <span class="hint">(the X-90 is in your pack: ${teachVerb('use', 'use', 'X-90 Sequence Holocaster')} — or type <b>i</b> to see what you're holding)</span>` };
  }
  if (to.id === Z_COLLAPSE && !(await isSet(player, F_COLLAPSE))) {
    if (!(await isSet(player, F_PLAYED))) setBeacons(player, [B_CHAIR]);
    return { block: true, message: (await isSet(player, F_PLAYED))
      ? `Not yet. The broadcast has not finished with you.`
      : `You cannot leave. The chair is the only way onward, and it is still waiting. <span class="hint">(try: ${teachVerb('sit', 'sit', 'metal chair')})</span>` };
  }
  return undefined;
}
registerMoveGate(prologueMoveGate, 'prologue');

// (The void's "there is no light, but you can see" is now an engine property:
// each prologue zone carries flags.always_lit, honored in getZoneVisibility.)

// ── Specialized `use` handlers (self-gating; return undefined to fall through) ─
// Match the holosign — including a bare "holo" — but NOT the similarly-named
// holocaster (its own handler owns those terms, and "holocaster" contains "holo").
function namesHolocaster(t) {
  return t.includes('holocaster') || t.includes('caster') || t.includes('x-90') || t.includes('x90') || t.includes('sequence');
}
function namesHolosign(t) {
  return !namesHolocaster(t) && (t.includes('holosign') || t.includes('holo') || t.includes('sign'));
}

// `read holosign` is simply `examine holosign` — nothing more. A wall of glowing
// text is a thing you READ, and a first-time player types the verb the fiction
// hands them, so the object answers to it instead of saying "Unknown command".
//
// Registered WITHOUT a requiredTag on purpose. A tag-gated entry would also show
// up in `availableActions`, which would advertise READ on the holosign's room
// link as though it were a second, different thing to do — it isn't. Examine is
// the one door: it prints the sign AND lists the actions on it, and USE is the
// one you click from there. Ungated entries are invisible to the reverse lookup
// and still fire, which is exactly what an alias wants. The handler self-gates
// on zone and name, so the global `read` verb still belongs to bulletins, job
// boards and the cookbook.
async function readHolosign(args, raw, player, broadcast) {
  const target = args.join(' ').toLowerCase();
  if (!namesHolosign(target)) return undefined;
  if (player.current_zone !== Z_LATTICE) return undefined;
  return cmdExamine(target, player, broadcast);
}

async function useHolosign(args, raw, player) {
  const target = args.join(' ').toLowerCase();
  if (!namesHolosign(target)) return undefined;
  if (player.current_zone !== Z_LATTICE) return undefined;

  if (await isSet(player, F_INTERFACED)) {
    return { type: 'emote', message: `You reach into the holosign again. It has already given you what it had to give: strength, and a way onward. The rest you take out there.` };
  }

  await raise(player, F_INTERFACED);
  await grantAllStatsPlusOne(player);
  await grantArchitectInterfaceIp(player);
  await grantItem(player, ITEM_HOLOCASTER);

  // The holosign has nothing more to point at; the next object is in your hands.
  setBeacons(player, []);
  playSoundscript(player, [{ at: 0, def: SFX.latticeTouch }, { at: 1500, def: SFX.grant, gain: 0.8 }]);

  out(player, `<span class="ip-gain">The lattice pours into you and leaves you more than it found you. +1 to every attribute: brawn, reflexes, endurance, brains, cool, senses.</span> <span class="hint">(that's your six STATS — buy more later with XP and RAISE)</span>`);
  out(player, `<span class="ip-gain">+1 IP — Architect Interface</span> <span class="hint">(reaching into the lattice was itself a SKILL; skills climb every time you use them — 100 IP is a level)</span>`);
  // The handoff, made physical: the thing doesn't "appear in your inventory", it
  // is pushed out of the light INTO YOUR HAND and your fingers close on it. Then
  // one sentence naming the only thing left to do with it, with the verb itself
  // shimmering. No tablet is mentioned here on purpose — there isn't one yet (see
  // firstClothing, where the city issues it), so the room link and the verb are the
  // whole of the nudge.
  setTimeout(() => {
    out(player, `The light in front of you thickens, bunches, and <b>hands you something</b>, pushes it out of itself the way a wave puts a stone on a beach. Your fingers are already closed around it before you decide to close them. A palm-sized wedge of warm ceramic, one seam, one stud: an <span class="action-link" data-action="examine" data-target="X-90 Sequence Holocaster" title="Examine the X-90 Sequence Holocaster"><b>X-90 Sequence Holocaster</b></span>.`);
  }, 1500);
  setTimeout(() => {
    out(player, `<span class="ambient">There is a stud under my thumb, and only one thing to do about it.</span> <span class="hint">(${teachVerb('use', 'use', 'X-90 Sequence Holocaster')} — or click it up in the room)</span>`);
  }, 3400);

  return { type: 'emote', message: `You reach into the holosign and, impossibly, the lattice reaches back. For one bright second you are touching the thoughts of the thing that made you. Every sinew, every nerve, every thought sits a fraction sharper than before.` };
}

async function useHolocaster(args, raw, player) {
  const target = args.join(' ').toLowerCase();
  const named = target.includes('holocaster') || target.includes('x-90') || target.includes('x90') || target.includes('sequence');
  if (!named) return undefined;

  const { rows } = await query(
    'SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 LIMIT 1',
    [player.id, ITEM_HOLOCASTER]
  );
  if (!rows.length) return undefined; // not carrying it → let the builtin answer

  await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, ITEM_HOLOCASTER]);
  await raise(player, F_BROADCAST);

  // The set piece. Everything the client can be asked to do at once: a five-beat
  // soundscript (click → split → the long knitting rise), the ion-storm weather
  // overlay lit over the room for the length of it (green wash + lightning arcs
  // over the pane — the lattice is, briefly, WEATHER), and the prose paced to
  // land between the cues instead of arriving all in one paragraph. Every one of
  // these is a cosmetic push the client is free to ignore — WeatherFX off, motion
  // off, audio off — and the beat still reads on the text alone.
  playSoundscript(player, [
    { at: 0,    def: SFX.casterClick },
    { at: 700,  def: SFX.casterSplit, gain: 0.95 },
    { at: 2100, def: SFX.doorway },
    { at: 4200, def: SFX.doorway, gain: 0.4 },
    { at: 6000, def: SFX.grant,   gain: 0.55 },
  ]);
  sendToPlayer(player.id, { type: 'weather_event', eventType: 'ion_storm', phase: 'peak' });
  setTimeout(() => sendToPlayer(player.id, { type: 'weather_event', eventType: null, phase: null }), 7000);

  setTimeout(() => out(player, `<span class="ambient">The seam splits with a sound like a held breath let go, and the wedge comes apart in your hand into two halves that no longer weigh anything.</span>`), 900);
  setTimeout(() => out(player, `<span class="ambient">Light unspools out of the gap. Not a beam. A THREAD, miles of it, pouring north faster than you can follow and knitting itself into geometry as it goes. The dark goes green at the edges. Somewhere far above your head the air cracks, twice, like a storm that has been waiting a long time to be let indoors.</span>`), 2400);
  setTimeout(() => out(player, `<span class="ambient">It finishes. There is a doorway where there was no wall to put one in, and it is breathing light.</span>`), 4600);
  setTimeout(() => {
    out(player, `<span class="ambient">The X-90 is spent. Both halves gone to dust, and the dust gone too. One key. One lock.</span> <span class="hint">(the way ${teachVerb('north', 'go', 'north')} is open)</span>`);
    setBeacons(player, [B_NORTH]);
  }, 6100);

  return { type: 'emote', message: `Your thumb finds the stud as if it always knew where it was.` };
}

export const specializedActions = [
  { verb: 'use', requiredTag: 'prologue_holosign',   handler: useHolosign },
  { verb: 'use', requiredTag: 'prologue_holocaster', handler: useHolocaster },
  // A silent alias for examine — deliberately ungated so it never advertises
  // itself as an action on the sign (see readHolosign).
  { verb: 'read', handler: readHolosign },
  { verb: 'read', handler: readTwocellAdvert },
];

// ── Chargen alignment: the attendant "predicts" your answer ───────────────────
// A single "Apply Changes" click can fire several morphex sub-commands back to
// back (one per changed attribute), each emitting appearance.changed. emit()
// doesn't await its subscribers, so without a guard all of them can race past
// the `isSet` check before the first one's flag write commits — five identical
// alignment lines. actor._prologueAligning claims the moment SYNCHRONOUSLY
// (before any await), so whichever invocation runs first wins and every other
// invocation from the same burst short-circuits immediately.
on('appearance.changed', async ({ actor }) => {
  if (!actor || actor.current_zone !== Z_INBETWEEN) return;
  if (actor._prologueAligning) return;
  actor._prologueAligning = true;
  if (await isSet(actor, F_ALIGNED)) return;
  await raise(actor, F_ALIGNED);

  // The reaction is IMMEDIATE and it MOVES. The terminal releases you (the panel
  // is a modal — a reaction delivered behind it may as well not have happened),
  // the attendant steps aside and motions north, and the exit takes up the
  // shimmer the terminal just put down. No step of the prologue is ever left
  // without a lit object in the room pane.
  setTimeout(() => sendToPlayer(actor.id, { type: 'morphex_close' }), 900);
  playSoundscript(actor, [{ at: 900, def: SFX.grant, gain: 0.6 }]);

  out(actor, `The terminal goes quiet mid-cycle, as though it has been switched off from somewhere else. The attendant is already looking at you. It started before the machine finished.`);
  setTimeout(() => {
    out(actor, `"Yes," it says. "This is exactly how I predicted you would answer. You are in alignment." It sounds pleased. The certainty of it crawls up the back of your neck.`);
  }, 2200);
  setTimeout(() => {
    // The motion forward: a body language beat, not a hint line. The hint rides
    // along behind it because a first-timer still needs the verb spelled out.
    out(actor, `<span class="ambient">Then it does something it has not done since I got here: it MOVES. One long chrome arm comes up and unfolds northward, and it steps out of my way, and it holds the gesture: patient, absolute, an usher at a door I cannot see. There is nowhere else in this room to be.</span> <span class="hint">(go ${teachVerb('north', 'go', 'north')})</span>`);
    setBeacons(actor, [B_NORTH]);
  }, 5000);
  setTimeout(() => {
    out(actor, `It adds, almost as an afterthought, without lowering the arm: "If that shape isn't the whole of you, there is a word for the rest. Type <b>.describe</b> and whatever you write, others will see when they look at you."`);
  }, 8600);
});

// ── The Broadcast: sitting plays the welcome ──────────────────────────────────
// Guarded by a per-player in-memory cooldown rather than the permanent F_PLAYED
// flag. The completion beat (kit drop + F_COLLAPSE door) only fires from the
// final setTimeout, so a player who disconnects mid-playback would otherwise be
// left with F_PLAYED set but F_COLLAPSE never raised — permanently soft-locked,
// since re-sitting was blocked and the door never opened. Now: once the door is
// open we're done for good (F_COLLAPSE); otherwise a re-sit after the cooldown
// (which the disconnect clears) replays the welcome and can finish it properly.
const BROADCAST_COOLDOWN_MS = 60000; // longer than one full playback (~45s)
on('posture.changed', async ({ player, to }) => {
  if (!player || to !== 'sitting' || player.current_zone !== Z_BROADCAST) return;
  if (await isSet(player, F_COLLAPSE)) return; // already finished it — door is open
  const now = Date.now();
  if (player._prologueBroadcastAt && now - player._prologueBroadcastAt < BROADCAST_COOLDOWN_MS) return;
  player._prologueBroadcastAt = now;
  await raise(player, F_PLAYED); // marks "has begun" for the move-gate message; no longer gates replay
  playBroadcast(player);
});

// ── Arrival: the first thought a new soul ever has ───────────────────────────
// Registration drops the player straight into The Inbetween, so there is no
// zone.entered to hang this off — the login push is the arrival. Two beats: the
// missing memory, then the attendant, closing on the first verb the game ever
// teaches (talk, shimmering per teachVerb) plus a ripple on the attendant's link
// up in the room pane, so the nudge exists in both places a player might look.
const F_ARRIVED = 'prologue_arrival_seen';
on('player.login', async ({ id }) => {
  const player = getLivePlayer(id);
  if (!player || player.current_zone !== Z_INBETWEEN) return;
  if (await isSet(player, F_ARRIVED)) return;
  await raise(player, F_ARRIVED);

  // ── The escape hatch, before anything else ─────────────────────────────────
  // THE FIRST THING IN THE LOG, ahead of the cinematic. A player using a screen
  // reader has no way to guess that this game can be played entirely in text —
  // and the setting lives in a tablet they will not be handed for another ten
  // minutes. `displaymode` is a plain verb with no tablet gate, so it works right
  // here at the first prompt; the only thing missing was anybody saying so.
  //
  // It also names the skip. The cinematic that follows is ~50 seconds and states
  // its own skip hint VISUALLY, which is no use to somebody who cannot see it —
  // so a player who would otherwise sit through a minute of silence is told, in
  // the log, that Escape ends it.
  sendToPlayer(player.id, {
    type: 'output',
    message: '<span class="msg-system">This game can be played entirely in text. '
      + '<span class="action-link" data-action="cmd" data-cmd="displaymode log">displaymode log</span>'
      + ' turns off every panel and writes everything here instead; '
      + '<span class="action-link" data-action="cmd" data-cmd="displaymode textgames">displaymode textgames</span>'
      + ' keeps the games but draws them in characters. You can change it any time.'
      + '<br>An opening sequence is about to play. Press <b>Escape</b> to skip it.</span>',
  });

  // The cold open runs FIRST and alone (client/game/js/panels/intro-cinematic.js).
  // Nothing below is scheduled here: the client echoes `introdone` when the
  // sequence ends or is skipped, and that verb starts the arrival. Otherwise a
  // player who watches the whole thing comes back to a log full of prose that
  // scrolled past while they were reading a different screen.
  //
  // A player on the bottom rung gets the SAME sequence with `mode: 'log'` — the
  // lines land in the log on their beats over the same score, and no overlay is
  // ever built (see playIntroLog in client/game/js/panels/intro-cinematic.js).
  // It used to skip straight to `beginArrival` on the grounds that an animation
  // is dead air, which was half true: the picture is optional, the twelve lines
  // are the piece. Either way the echo is `introdone` and the timing below is
  // unchanged, because the log rung runs to the same RUN_MS.
  //
  // THE RUNG IS KNOWN HERE, and it took a second seam to make it so. It is gated on
  // F_ARRIVED, so it runs once, for a character who has never had a prompt — who
  // for a long time could not possibly have set a rung yet, which made it read
  // `undefined` almost every time and left the LINE above (naming Escape) doing
  // all the real work. The auth screen now carries a "Playing with a screen
  // reader?" disclosure whose choice rides the auth/register message and is
  // applied in finishAuth ahead of this hook, so a player who picked `log`
  // before they ever logged in genuinely never sees the cinematic. The line
  // above still matters for everyone who didn't find the disclosure.
  sendToPlayer(player.id, { type: 'intro_cinematic', skyline: coldwaterSkyline(), shore: coldwaterShore(),
    ...(loggedPanelsSync(player) ? { mode: 'log' } : {}) });
  // Safety net for a client that never answers (an old cached bundle, a tab
  // closed and reopened mid-play): the prologue must never be able to stall.
  // beginArrival is idempotent, so the real echo winning this race is fine.
  setTimeout(() => { const p = getLivePlayer(id); if (p) beginArrival(p); }, INTRO_FALLBACK_MS);
});

// Everything the prologue says on arrival, gated behind the cold open. Split out
// of the login handler so `introdone` can trigger it, and guarded by an in-memory
// claim (not a flag) because both callers can arrive within the same tick.
// Longer than the client's start gate (it auto-begins at 20s if nobody clicks
// "Begin") PLUS the full cinematic and its fade. Sized off the WORST case,
// not the usual one: if this fires while the sequence is still playing, the
// arrival prose lands behind the overlay and scrolls past unread — the exact
// failure the cold-open gating exists to prevent. See the start gate in
// client/game/js/panels/intro-cinematic.js; the two numbers move together.
//
// 20s gate + RUN_MS 51s × SLOW 1.35 (≈69s) + the closing fade ≈ 90s, and this
// keeps the same ~20s of headroom over that as it always had. It was 92000 when
// the run was unscaled, which the tempo change would have quietly cut to about
// two seconds of margin — enough to hold on a fast machine and fire over the
// wordmark on a slow one.
const INTRO_FALLBACK_MS = 110000;
// If the interface question is never answered — a tab left open on the veil, a
// client that lost the socket mid-tour — the prose comes anyway rather than the
// player standing in a silent room forever. Generous, because a first-timer
// reading every tour card genuinely can take minutes.
const TOUR_FALLBACK_MS = 480000;
async function beginArrival(player) {
  if (player._prologueArrivalStarted) return;
  player._prologueArrivalStarted = true;
  // Before any fiction: the interface question, and NOTHING ELSE. The prose used
  // to start 900ms behind the offer, which meant a new player answering it — or
  // walking the tour — came back to a log they'd already scrolled past. The
  // client dims the whole interface around the question (tour.js), and speaks
  // only once it's answered: `tutorial no` releases it immediately, `tutorial
  // done` releases it at the end of the walkthrough. Client-side from here — the
  // server only records the answer so a player isn't asked again on a second
  // device.
  if (!(await isSet(player, F_TOUR_ASKED))) {
    // 1200ms, not 500: the cinematic's own closing dissolve is still running.
    // The question should arrive as the logo finishes leaving, not over it.
    // At the `log` rung the offer is asked IN THE LOG and answered by verb — the
    // client's version dims an interface this player isn't looking at, and walks
    // them round panels that aren't drawn (see speakLogTour).
    setTimeout(() => {
      const p = getLivePlayer(player.id) || player;
      if (loggedPanelsSync(p)) logTourOffer(p);
      else sendToPlayer(p.id, { type: 'tour_offer' });
    }, 1200);
    setTimeout(() => { const p = getLivePlayer(player.id) || player; speakArrival(p); }, TOUR_FALLBACK_MS);
    return;
  }
  speakArrival(player);
}

// The arrival prose itself. Split out of beginArrival so the tour can gate it,
// and claimed in memory (not a flag) because several callers race for it: the
// tour answer, the tour's end, and both fallbacks.
// The last arrival line lands at 17600ms (below); ARRIVAL_DONE_MS is when the
// client's `tour_tablet` handoff is allowed to fire — a beat after that line is on
// screen, not the instant it appears, so a player has a moment to read it before
// the tablet's boot chrome covers the log.
const ARRIVAL_DONE_MS = 18400;

function speakArrival(player) {
  if (!player) return;
  // Zone-guarded: `tutorial` is replayable forever, and a veteran replaying it in
  // Coldwater must not be told they don't know how they got here. Same for a
  // second call once the monologue has already played (both the tour's own end
  // and the "no tour" fallback can reach this). Neither case has any prose left to
  // wait for, so the tablet handoff (see `tutorial done` below) is cleared to fire
  // immediately rather than sitting on a timer for prose that's never coming.
  if (player.current_zone !== Z_INBETWEEN || player._prologueArrivalSpoken) {
    sendToPlayer(player.id, { type: 'tutorial_prose_done' });
    return;
  }
  player._prologueArrivalSpoken = true;
  setTimeout(() => out(player, `<span class="ambient">I don't know how I got here. That's the first thing. Not <i>where</i> I am. <i>How</i>. I reach back for the moment before this one and my hand closes on nothing at all. There was something. There must have been something. A name, a room, a life with a Tuesday in it. It's gone the way a dream goes, and I can't even find the shape of the hole it left.</span>`), 1400);
  setTimeout(() => {
    out(player, `<span class="ambient">Then I notice I'm not alone.</span>`);
  }, 8200);
  setTimeout(() => {
    out(player, `<span class="ambient">It's tall, and it's chrome. Warm chrome, seamless, shaped like a person the way a word is shaped like the thing it means. No face, just a smooth curve where one belongs, and I'd swear it's looking at me. When it shifts its weight the light follows a half-second late. One hand rests on a humming terminal. It doesn't hurry. It has the stillness of something that's been standing exactly there for a very long time, waiting for exactly me.</span>`);
  }, 11400);
  setTimeout(() => {
    out(player, `<span class="ambient">Maybe I should ${teachVerb('talk', 'talk', 'chrome attendant')} to it.</span>`);
    pointAt(player.id, 'talk', 'chrome attendant');
    // …and then HE keeps shimmering, alone, until you talk to him. Not the
    // terminal: he hasn't mentioned it yet, and a room with two glowing things
    // in it is a room with no answer in it.
    setBeacons(player, [B_ATTENDANT]);
  }, 17600);
  // The interface tour's last step opens the tablet on finish ("Open the tablet");
  // without this signal the client would have to guess how long the monologue runs
  // and either cut it off or leave an awkward dead pause. This tells it exactly
  // when the room has gone quiet.
  setTimeout(() => sendToPlayer(player.id, { type: 'tutorial_prose_done' }), ARRIVAL_DONE_MS);
}

// ── Room telegraphs + the wake-up beat ────────────────────────────────────────
on('zone.entered', async ({ actor, zone, from }) => {
  if (!actor) return;
  // Weather/clock on or off, every move, in both directions — including the step
  // out of the collapse into the vat, which is where the real world starts.
  envUnreal(actor, !!getZone(zone)?.flags?.prologue);
  if (zone === Z_LATTICE) {
    out(actor, `<span class="ambient">The holosign turns to face you. It wants to be read.</span> <span class="hint">(try: ${teachVerb('examine', 'examine', 'floating holosign')} — it'll show you what you can do with it)</span>`);
    if (!(await isSet(actor, F_INTERFACED))) setBeacons(actor, [B_HOLOSIGN]);
    else if (!(await isSet(actor, F_BROADCAST))) setBeacons(actor, []);
    else setBeacons(actor, [B_NORTH]);
  } else if (zone === Z_BROADCAST) {
    out(actor, `<span class="ambient">The chair is the only thing here.</span> <span class="hint">(try: ${teachVerb('sit', 'sit', 'metal chair')})</span>`);
    if (!(await isSet(actor, F_COLLAPSE))) setBeacons(actor, [B_CHAIR]);
  } else if (zone === Z_COLLAPSE) {
    setBeacons(actor, [B_NORTH]);
  } else if (zone === Z_CLONEVAT && from === Z_COLLAPSE) {
    // Out the other side: the prologue stops steering. Everything it lit goes dark.
    setBeacons(actor, []);
    beaconClear(actor.id);
    out(actor, `<span class="clone-vat-message">You wake. There is a floor now, cold and real, and a body on it that is yours, and it already aches. The vat behind you hisses shut. The between is gone as if it never was. Somewhere far above, an algorithm notes that its very large number is, once again, correct.</span>`);
    firstClothing(actor);
  }
});

// The first emergence from the vat plays the same body-assimilation and dressing-
// robot beats a respawn gets (see scheduleVatEmergence in gameLoop.js) — but the
// very first clone is on the house, so no cloning bill prints. Timings mirror the
// respawn sequence so the two feel like the same machine.
function firstClothing(actor) {
  // The one thing the copy MUST keep in step with the original: the naked window.
  // A first clone is bare from the moment it hits the floor until the gantry
  // dresses it, and the surveillance scan runs on its own tick — so without this
  // a brand-new player, whose first five seconds of the game are being dressed by
  // a machine against their will, got booked for indecent exposure for it. Cleared
  // only once the equips have LANDED, plus a grace window (see gameLoop.js).
  actor._vatDressing = true;
  setTimeout(() => {
    out(actor, `<span class="clone-vat-message">Your new body reports in, one seam at a time. Nerve endings find their sockets and announce themselves: cold, ache, the dumb weight of your own hands. Muscle remembers what muscle is for. You are, unmistakably, meat again.</span>`);
  }, 2600);
  setTimeout(async () => {
    let grace = 4000;
    // Named by the engine, never here — the vat's torso garment is seasonal, so a
    // list typed into this file is a promise the gantry stops keeping in October.
    let outfit = 'underwear, pants, a shirt, a pair of shoes';
    try {
      const { equipStarterOutfit, VAT_DRESS_GRACE_MS, starterOutfitPhrase } = await import('../../server/engine/gameLoop.js');
      grace = VAT_DRESS_GRACE_MS ?? grace;
      await equipStarterOutfit(actor.id, actor.biological_sex || 'male');
      outfit = starterOutfitPhrase();
    } catch (e) {
      console.error('[prologue] starter outfit failed:', e.message);
    } finally {
      // Always released, even if the equips threw — a stuck `_vatDressing` would
      // make a player permanently immune to the charge, which is a worse bug than
      // the one this fixes.
      setTimeout(() => { actor._vatDressing = false; }, grace);
    }
    out(actor, `<span class="clone-vat-message">A dressing gantry unfolds on too many arms and plants you upright in the lab. It sheathes you with the tenderness of an industrial press: ${outfit}. No invoice prints. The first clone, it seems, is free.</span>`);
  }, 5200);
  // The place-name lands HERE and nowhere earlier: the cold open alludes to
  // Coldwater as history and the prologue refuses to name it, so the first time
  // the word attaches to somewhere you're standing is the moment you're standing
  // in it. A stencil on a wall — the world telling you, not a voice welcoming you.
  setTimeout(() => {
    out(actor, `<span class="clone-vat-message">There is stencilling on the wall opposite, half-scoured by whatever they wash this room down with. You read it twice before it means anything. <b>COLDWATER BASIN — RESIDENT REINSTATEMENT</b>. Under it, in letters twice the size, in the flat voice of a thing that has printed it ten million times: <b>WELCOME BACK</b>.</span>`);
  }, 8400);
  // ── The tablet ──
  // The device arrives HERE and nowhere earlier. Everything before this room is a
  // corridor with no floor, and a player standing in it holding a city services
  // terminal was the one thing in the prologue that came from nowhere; now the
  // reinstatement machine issues it, along with everything else it issues. The
  // client turns its tablet controls on off the back of this (`tablet_access`) and
  // pops the chip in the smart bar (`tablet_offer`) — see client/game/js/panels/
  // smartbar.js — so the tutorial is something the player CHOOSES to take, not a
  // walkthrough that opens over the top of the room they just woke up in.
  setTimeout(async () => {
    await raise(actor, F_TABLET);
    out(actor, `<span class="clone-vat-message">A hatch coughs open at hip height and something slides out of the wall at you, hard enough that catching it is not really optional: a slab of scuffed grey glass, warm on one side, a hairline crack across the corner that somebody has decided is within tolerance. Your name is already on it. Your <b>tablet</b>. Issued, apparently, to whoever ends up wearing this body.</span>`);
    out(actor, `<span class="ambient">It wakes when I touch it, and it seems to think I'll know what to do with it.</span> <span class="hint">(it's in your bar, bottom left — or type <b>tablet</b> any time)</span>`);
    tabletAccess(actor, true);
    // The chip in the bar opens a walkthrough of the tablet SHELL, which a player
    // at the `log` rung never gets — `tablet` hands them a typed index instead
    // (plugins/tablet/index.js). Same offer, written out, and it doesn't expire
    // after 25 seconds the way the chip does.
    if (loggedPanelsSync(actor)) {
      out(actor, `<span class="hint">${cmdLink('tutorial tablet', 'tutorial tablet')} walks you through what's on it.</span>`);
    } else {
      sendToPlayer(actor.id, { type: 'tablet_offer' });
    }
    // Backstop: the chip and its walkthrough are both optional and both live on the
    // client, so the poster beat can never be allowed to depend on them. If nothing
    // has answered by now, point at the wall anyway — this is the only beat in the
    // whole prologue that tells a new player where to GO.
    setTimeout(() => pointAtAdvert(getLivePlayer(actor.id) || actor), ADVERT_FALLBACK_MS);
  }, 11200);
}

// The tablet the vat issues you, and the client's permission to draw its controls.
// A flag rather than an item because the tablet has never been an item — it's the
// second half of the interface (plugins/tablet/), and this is the record of the
// moment it turned up. Nothing outside the prologue reads it: the refusal in
// plugins/tablet/index.js is keyed off the ZONE, so a character who predates this
// beat is unaffected.
const F_TABLET = 'tablet_issued';
function tabletAccess(player, has) {
  if (player) sendToPlayer(player.id, { type: 'tablet_access', has: !!has });
}

// ── No weather, no clock ─────────────────────────────────────────────────────
// The corridor is not a place. A HUD reading "☁ 14°C · light rain · 03:42" over a
// room with no floor tells a brand-new player that the metaphysical space they're
// standing in is really just an interior tile in Coldwater — the loudest immersion
// break in the whole prologue. So the client is told to drop the weather readout
// entirely and scramble the time for as long as the zone carries `flags.prologue`
// (client/game/js/panels/environment.js → setEnvUnreal). Keyed off the ZONE flag,
// exactly like tabletAccess, so a new prologue room needs no code here; sent in
// both directions unconditionally because the client boots assuming real weather.
function envUnreal(player, unreal) {
  if (player) sendToPlayer(player.id, { type: 'env_unreal', unreal: !!unreal });
}

// The tablet controls are hidden for anyone standing in the corridor, and shown
// again the moment they aren't — on every login, not just the first, so a player who
// closes the tab mid-prologue and comes back doesn't return to a bar that offers a
// device they don't have yet. Sent unconditionally in both directions because the
// client boots assuming it HAS a tablet (every existing character does).
on('player.login', async ({ id }) => {
  const player = getLivePlayer(id);
  if (!player) return;
  const inCorridor = !!getZone(player.current_zone)?.flags?.prologue;
  tabletAccess(player, !inCorridor);
  envUnreal(player, inCorridor);
  // Recovery: the chip, its 25s timer and the advert backstop are all timers, and
  // timers die with the connection. A player who closed the tab in the ten seconds
  // between the tablet arriving and answering the chip would otherwise come back to
  // a vat with nothing pointing anywhere. They have had their tablet; give them the
  // signpost. Flag-guarded, so it cannot double up on someone who already got it.
  if (player.current_zone === Z_CLONEVAT && await isSet(player, F_TABLET)) {
    setTimeout(() => pointAtAdvert(getLivePlayer(id) || player), 4000);
  }
});

// ── The advert ──
// The LAST beat of the prologue, and the only one that points at somewhere to go. A
// player standing in the vat with a bat, a helmet and ₵100 has no idea that anything
// in this city wants them — Grady's poster is the first thing that does, and it is
// already on this wall (furn_poster_twocell_supply). The beat just makes sure it's
// SEEN: an ambient nudge, the `read` verb taught with the usual shimmer, and a
// ripple on the poster's own link up in the room pane, so the nudge exists in both
// places a new player might be looking.
//
// It waits for the tablet walkthrough to be over (or declined — see `tabletdone`),
// because these are the same two lines of the log: a poster nudge delivered under a
// spotlight overlay is a poster nudge nobody reads.
//
// The nudge names the STAKES rather than the errand. "There is a poster" is a
// piece of scenery; "you have ₵100, you will need to eat, and nobody is coming"
// is a reason to walk across a room. Everything a new player does for the next
// hour is paid for out of that number.
const F_ADVERT = 'prologue_advert_nudged';
const F_ADVERT_READ = 'prologue_advert_read';
const ADVERT_FALLBACK_MS = 210000;   // ~3.5 min: a first-timer can read every tour card
const ADVERT_AUTOREAD_MS = 40000;    // if the nudge goes unanswered, read it FOR them
async function pointAtAdvert(actor) {
  if (!actor || actor.current_zone !== Z_CLONEVAT) return;
  if (await isSet(actor, F_ADVERT)) return;
  await raise(actor, F_ADVERT);
  out(actor, `<span class="ambient">The credits in your pocket are the only credits there are. Nobody is sending more. In a day or two you will be hungry, and in a week somebody will want rent, and neither of those things cares that you were decanted this morning.</span>`);
  out(actor, `<span class="ambient">Something on the wall by the door is trying very hard to get your attention. It is doing this the way a man with no budget does it: a paper advert, hand-pasted, hung crooked, with a photograph of somebody's face on it roughly four times life size. The word under the face is WORK.</span>`);
  out(actor, `<span class="ambient">Maybe I should ${teachVerb('read', 'read', 'advert')} it.</span>`);
  pointAt(actor.id, 'read', 'advert');
  // Backstop for the whole prologue: this is the ONLY beat that tells a new
  // player where to go, so it cannot be allowed to depend on them typing
  // anything. If the nudge goes unanswered, read the thing for them — a player
  // stalled in an empty room with no destination is the failure this exists to
  // prevent, and being handed a poster you were already staring at costs nothing.
  setTimeout(() => autoReadAdvert(getLivePlayer(actor.id) || actor), ADVERT_AUTOREAD_MS);
}

// The read-it-for-them path. Same two halves as the verb (the poster's own text,
// then the offer), phrased as the character's eye drifting back to it rather than
// as a command they didn't type.
async function autoReadAdvert(actor) {
  if (!actor || actor.current_zone !== Z_CLONEVAT) return;
  if (await isSet(actor, F_ADVERT_READ)) return;
  await raise(actor, F_ADVERT_READ);
  const seen = await cmdExamine('advert', actor, () => {});
  if (!seen || seen.type === 'error') return;
  out(actor, `<span class="ambient">There is nothing else in here to look at, so I look at it properly.</span>`);
  out(actor, seen.message);
  offerTwocellDirections(actor);
}

// The offer: a ten-minute walk, and why it's worth taking. Deliberately a
// QUESTION with two buttons rather than a route silently appearing on the map. A
// new player who has been steered down a one-way corridor for ten minutes should
// be asked, once, whether they want to be steered again — and be able to say no.
function offerTwocellDirections(player, delay = 400) {
  const dest = getZone(Z_TWOCELL_TILE);
  if (!dest) return;
  setTimeout(() => out(player, `<span class="ambient">The address is at the bottom, under the crates. It's a ten-minute walk. Grady pays for work, and paid work is food, and enough of it is a door you can lock behind you. That's the entire plan, for now.</span> ` +
    // Yes routes AND sets off (the `!go` flag) — the question has already been
    // asked here, so the gps prompt asking it a second time would be a nag.
    `<span class="action-link prompt-link" data-raw-cmd="gps ${dest.name} !go" data-label="walk to Two-Cell Supply">Show me the way</span> ` +
    `<span class="action-link prompt-link prompt-link-ghost" data-client-cmd="echo Suit yourself." data-label="no thanks">Not now</span>`), delay);
}

// ── Reading the advert offers you the way there ──────────────────────────────
// `read` is registered UNGATED (same trick as readHolosign): it must never
// advertise itself as a second action on the poster's room link, because
// `examine` is the one door and this is a quiet alias behind it. Self-gates on
// zone + target and returns undefined for everything else, so the global `read`
// still belongs to bulletins and job boards.
const Z_TWOCELL_TILE = 'zone_district_920_903';   // the Two-Cell Supply facade
const namesAdvert = (t) => /\b(advert|advertisement|poster|two.?cell|supply|grady)\b/.test(t);

async function readTwocellAdvert(args, raw, player, broadcast) {
  const target = args.join(' ').toLowerCase();
  if (!namesAdvert(target)) return undefined;
  if (player.current_zone !== Z_CLONEVAT) return undefined;

  const seen = await cmdExamine(target, player, broadcast);
  // Only offer directions if that actually resolved to something readable —
  // otherwise "read supply" against a missing poster would answer with an error
  // AND an offer to walk somewhere, which is nonsense.
  if (!seen || seen.type === 'error') return seen;

  // Read on purpose — the auto-read backstop stands down.
  await raise(player, F_ADVERT_READ);
  offerTwocellDirections(player);
  return seen;
}

// The welcome script — timed, styled, and unstoppable: it runs on its own timers,
// so standing up doesn't halt it (per design). Ends by dropping the starter kit
// to the floor and opening the way to The Collapse.
function playBroadcast(player) {
  const lines = [
    `<span class="broadcast-line">A screen blinks into being on the wall that wasn't there. It fills the black with a light the color of an old television.</span>`,
    `<span class="broadcast-line">"HELLO. AND WELCOME." The voice is warm in the way a recording of warmth is warm.</span>`,
    // Deliberately names neither the destination nor the arrival. The player has
    // not gone anywhere yet; the Architect simply starts talking about the plan.
    `<span class="broadcast-line">"The Architect has great plans for its new project. You will not be told what they are. That is not withholding. That is simply how plans this large are kept."</span>`,
    `<span class="broadcast-line">"The world you are entering is violent. Your choices are your own, and they will have consequences, and the consequences will be your own as well. You have free will. We are quite sure of this."</span>`,
    `<span class="broadcast-line">"You may be a combatant. You may be a criminal. You may be a crafter. You may be a businessman. It all fits within the plan. Everything fits within the plan."</span>`,
    `<span class="broadcast-line">"Behave as you would. That is all that is asked of you. Behave exactly as you would."</span>`,
    `<span class="broadcast-line">The screen holds on that a beat too long. Then it goes dark, and takes the wall with it.</span>`,
  ];
  let t = 1200;
  const step = 6400; // per-line interval; halved playback speed (was 3200)
  // SOUND. The bed starts BEFORE the first line — the room should already feel
  // wrong by the time the screen admits it's there — and swells one rung per
  // line, so the address gets heavier as it goes instead of opening at full
  // weight. Lines 1 and 6 (0-indexed) are narration, not the Architect speaking,
  // so they take the screen cues rather than a voice pulse.
  const lastIdx = lines.length - 1;
  startLoop(player, SFX.voiceBed);
  rideLoop(player, SFX.voiceBed.id, 0.35, 2.4);
  for (const line of lines) {
    setTimeout(() => out(player, line), t);
    t += step;
  }
  playSoundscript(player, [
    { at: 1200, def: SFX.screenWake, gain: 1 },
    // The pulse lands a beat BEFORE its sentence: the room presses, then the
    // voice arrives in the space it made.
    ...lines.slice(1, lastIdx).map((_, i) => ({
      at: 1200 + (i + 1) * step - 260,
      def: SFX.voiceLine,
      // "Behave exactly as you would" is the line the whole address exists to
      // deliver, so it gets the hardest press.
      gain: i === lines.length - 3 ? 1.15 : 0.75 + i * 0.08,
    })),
    { at: 1200 + lastIdx * step, def: SFX.screenDeath, gain: 1 },
  ]);
  // The bed climbs under the spoken lines, then goes with the screen. Stopped a
  // beat AFTER the death cue so the sub tail is the last thing in the room, and
  // stopLoop's own release ramps it rather than cutting it.
  for (let i = 1; i < lastIdx; i++) {
    const gain = Math.min(1, 0.35 + i * 0.16);
    setTimeout(() => rideLoop(player, SFX.voiceBed.id, gain, 2.0), 1200 + i * step - 400);
  }
  setTimeout(() => rideLoop(player, SFX.voiceBed.id, 0, 2.6), 1200 + lastIdx * step + 400);
  setTimeout(() => stopLoop(player, SFX.voiceBed.id), 1200 + lastIdx * step + 3400);
  // After the last line: the kit hits the floor and the way opens.
  setTimeout(async () => {
    try {
      if (await isSet(player, F_COLLAPSE)) return; // a prior playback already finished — don't re-drop the kit
      // The kit hits the FLOOR, and the prologue is one-way: walk north without
      // taking it and the bat, the helmet and the ₵100 chip are gone for good.
      // That hazard is deliberate — briefly changed to a straight inventory grant
      // on 2026-07-21 and reverted the same day. Leave it on the ground.
      const ground = `_ground_${Z_BROADCAST}`;
      for (const { id, qty, credits } of KIT) await grantItem(player, id, qty, ground, credits ? { credits, name: `credit chip (₵${credits})` } : null);
      await raise(player, F_COLLAPSE);
      // Highlight each dropped item as a clickable take-link (same convention as
      // the room's "Lying here:" list), then refresh the room so the ground items
      // are actually visible without the player having to look again.
      const mentions = KIT.map(({ name, qty }) => {
        const label = qty > 1 ? `${qty}x ${name}` : name;
        return `<span class="action-link room-item" data-action="take" data-target="${escAttr(name)}" title="Take ${escAttr(name)}">${label}</span>`;
      }).join(', ');
      out(player, `<span class="ambient">Objects thud onto the invisible floor in front of you, one after another, as if the dark is emptying its pockets:</span> ${mentions}. <span class="hint">(take them or leave them — then go ${teachVerb('north', 'go', 'north')} to the collapse)</span>`);
      // The pile on the floor shimmers, and NOT the exit alongside it — the exit
      // is the thing that costs you the kit, so lighting both at once would be
      // pointing two ways. The kit is one-way: walk north without it and the bat,
      // the helmet and the ₵100 chip are gone for good. North picks up its own
      // beacon when you actually leave (zone.entered → Z_COLLAPSE).
      setBeacons(player, KIT.map(({ name }) => ['take', name]));
      // …and the record of what you just watched. Volume I of the CODEX is handed
      // over whole here rather than earned, because the player has already seen
      // it — the cold open IS that volume, cut to thirty seconds. Everything in
      // Volume II is still sealed, and is learned out there. (Deliberately after
      // the kit line: gear first, reading second.)
      try {
        const { grantVolume } = await import('../tablet/codex-app.js');
        await grantVolume(player, 'quiet');
        // Filed, not handed over on a screen: there is no tablet in this corridor
        // (it's issued at the vat), so the volume waits in the record until there's
        // something to read it on.
        out(player, `<span class="ambient">Something else arrives with no sound at all. Not an object. A document, filed somewhere under your name, waiting for you to have somewhere to read it.</span> <span class="hint">(it'll be in your CODEX the moment you have a device; <b>codex</b> opens it)</span>`);
      } catch (e) {
        console.error('[prologue] codex grant failed:', e.message);
      }
      const zone = getZone(Z_BROADCAST);
      if (zone) sendToPlayer(player.id, { type: 'look', message: await describeZone(zone, player), zone: zone.id, minimap: getMinimapData(zone.id, 8, player) });
    } catch (e) {
      console.error('[prologue] broadcast kit drop failed:', e.message);
    }
  }, t + 400);
}

// ── First blood → Grady's chair ──────────────────────────────────────────────
// The one tutorial beat that lands AFTER the vat: the game never says out loud
// that sitting heals you. Grady does, once, the first time you walk back into
// his shop having killed something. Two flags — one records that you've fought,
// one that he's said his piece — so the tip can't fire before the fight or twice
// after it. Sitting itself is the interactions plugin's `sit`; the HP regen is
// the engine's (see docs/systems-posture.md). Nothing here touches either.
const Z_TWOCELL     = 'zone_twocell_interior';
const F_FIRST_BLOOD = 'grady_first_blood';   // player has won a fight
const F_SEAT_TIP    = 'grady_seat_tip';      // Grady has given the sit-to-heal tip

on('enemy.killed', async ({ actor }) => {
  if (!actor?.id) return;
  if (await isSet(actor, F_FIRST_BLOOD)) return;
  await raise(actor, F_FIRST_BLOOD);
});

on('zone.entered', async ({ actor, zone }) => {
  if (!actor || zone !== Z_TWOCELL) return;
  if (!(await isSet(actor, F_FIRST_BLOOD))) return;
  if (await isSet(actor, F_SEAT_TIP)) return;
  await raise(actor, F_SEAT_TIP);
  setTimeout(() => {
    out(actor, `<span class="ambient">Grady looks up, takes one read of the state of you, and jerks his chin at the sagging armchair by the crates. "Sit down before you fall down. Go on. Off your feet, and stay off 'em a while. Body knits itself back together when you stop asking it to carry you around. Cheapest medicine in the basin, and I can't charge you a credit for it."</span>`);
  }, 1200);
  setTimeout(() => {
    out(actor, `<span class="ambient">Maybe I should ${teachVerb('sit', 'sit', 'sagging vinyl armchair')} and let it mend.</span>`);
    pointAt(actor.id, 'sit', 'sagging vinyl armchair');
  }, 8000);
});

// ── The interface tour ───────────────────────────────────────────────────────
// The only out-of-fiction beat in the prologue: a first-time player is asked
// once whether they've played a multiplayer text game before, and if not the
// client walks them round the UI (spotlight + shimmer + a card per region; see
// client/game/js/panels/tour.js). The server's whole job is the memory of it —
// two flags, so the offer doesn't repeat on another browser — plus the verb
// that replays the tour on demand.
const F_TOUR_ASKED = 'tour_asked';   // the question has been put to them
const F_TOUR_TAKEN = 'tour_taken';   // they finished (or started) the walkthrough

// ── The same tour, spoken ────────────────────────────────────────────────────
// At the `log` rung the client's tour is worse than nothing: it spotlights the
// room pane (aria-hidden and collapsed at that rung — presentation.js) and the
// tablet shell (never built; `tablet` returns a typed index instead), so a
// player who cannot see it is walked round furniture that isn't in the room.
// So the bottom rung gets its own walkthrough, written out, and it teaches the
// DIFFERENT things — because the interface it is describing is different.
//
// The load-bearing one is `look`. On a move, only the vital lines reach the log
// (arrivalRoom in server/engine/room-brief.js: zone name, light, hazards,
// enemies) and the description, the furniture and the ambience are dropped. An
// explicit `look` is exempt and prints the room in full — see the type:'look'
// branch of stampToLog in server/index.js. Nothing anywhere said so, which left
// the one player who most needed the full description believing the four lines
// they heard were all there was.
//
// Self-paced, not timed: the visual tour waits for a click per card, so this
// waits for `tutorial done` — the same verb, releasing the same held-back
// arrival prose. TOUR_FALLBACK_MS still covers a player who answers nothing.
const cmdLink = (cmd, label) =>
  `<span class="action-link" data-action="cmd" data-cmd="${escAttr(cmd)}">${label || cmd}</span>`;

// ⚠ A CLIENT VERB IS NOT A COMMAND LINK. `auto` is handled in
// client/game/js/input.js and never reaches the socket, so the ordinary
// `data-action="cmd"` link above would send it and the server would answer
// `Unknown command` — a taught verb that fails on the one click it advertises.
// `data-client-cmd` is the route handleActionLinkClick hands to
// handleClientCommand instead (the same one the auto-walk y/n prompt uses).
const clientLink = (cmd, label) =>
  `<span class="action-link" data-client-cmd="${escAttr(cmd)}">${label || cmd}</span>`;

function logTourOffer(player) {
  out(player, `<span class="msg-system">You're in text mode, so here's the offer in text: a short walkthrough of how this game reads and how you type at it. `
    + `${cmdLink('tutorial yes', 'tutorial yes')} to take it, ${cmdLink('tutorial no', 'tutorial no')} if you've played a MUD before.</span>`);
}

const LOG_TOUR = [
  `<b>The room, and the two sizes of it.</b> When you walk into somewhere new you get the short version — the name of the place, how dark it is, anything about to hurt you, and anyone waiting. That's deliberate: it keeps a hallway from being twelve lines every step. The long version is always one word away. Type ${cmdLink('look')} and you get the room in full: what it looks like, what's in it, what you can sit on. Do it in any room you actually care about.`,
  `<b>Getting closer.</b> ${cmdLink('examine', 'examine &lt;thing&gt;')} — a person, an item, a door, a machine — tells you what it is and, at the end, what you can do with it. If a line ever leaves you thinking "and now what", examine the thing it named.`,
  `<b>Also here.</b> Items, corpses, vendors, furniture and doorways get folded into one line that starts "Also here:". It is a list of nouns you can examine, take or use. Nothing is ever hidden from you by being folded up — ${cmdLink('look')} unfolds all of it.`,
  `<b>Moving.</b> Directions are the verbs: <b>north</b>, <b>south</b>, <b>east</b>, <b>west</b>, and <b>n s e w</b> for short. The ways out are on the Exits line of every room, which you get on arrival and again from ${cmdLink('look')}. Buildings are entered by walking at them from the street.`,
  `<b>Your things and your body.</b> ${cmdLink('inventory', 'inventory')} (or <b>i</b>) is what you're carrying, ${cmdLink('gear')} is that plus what you're wearing, and ${cmdLink('score')} is you — health, hunger, thirst, money, the state you're in.`,
  `<b>The tablet.</b> The city issues you one shortly. In text mode it isn't a screen, it's a menu you type at: ${cmdLink('tablet')} lists it, and each app has a verb of its own — <b>map</b>, <b>bank</b>, <b>gear</b>, <b>quests</b>, <b>codex</b>. ${cmdLink('tablet verbs')} prints the whole list any time.`,
  `<b>Making it read better.</b> ${clientLink('accessibility')} on its own lists everything you can change about how this game reads — text size, typeface, how much motion there is, how much it beeps, and whether it reads itself aloud to you. Each one tells you exactly what to type to set it. It needs no tablet and works anywhere, which is the point: the switch that fixes the interface must not be inside the interface.`,
  `<b>When you're stuck.</b> ${cmdLink('help')} lists every command. Any verb the game teaches you it will name in the line where you first need it. And you can leave text mode as easily as you entered it — ${cmdLink('displaymode visual', 'displaymode visual')} turns the panels back on.`,
];

function speakLogTour(player) {
  out(player, `<span class="msg-system">— The walkthrough. Eight things, then you're on your own. —</span>`);
  for (const line of LOG_TOUR) out(player, `<span class="hint">${line}</span>`);
  out(player, `<span class="msg-system">That's it. Type ${cmdLink('tutorial done', 'tutorial done')} when you've finished reading and the room will carry on. `
    + `${cmdLink('tutorial')} replays this whenever you want it.</span>`);
}

// The tablet half, offered at the vat where the device is issued. Same reason:
// the smartbar chip opens a walkthrough of a shell this player never sees.
//
// ⚠ THE ROUTE LINES LIVE HERE, NOT IN LOG_TOUR. Everything the game says about
// getting somewhere is said in map language — the quest objectives say "follow
// the green GPS line", Grady bellows about a line on your map — and at this rung
// there is no map drawn to put a line on. The walking still works: `gps_route`
// is handled the same at every rung (client/game/js/dispatch.js), and the node
// payload that arms auto-walk is stored whatever is on screen, so `auto` is a
// real verb here and not a described one. It just had to be SAID, because the
// only places naming it point at a picture this player doesn't get.
//
// It belongs to the tablet half rather than the corridor tour because that is
// when it becomes true: the corridor is a one-way line of rooms with no map, no
// destination and no quest. The map and the first job both arrive with the
// device.
const LOG_TABLET_TOUR = [
  `${cmdLink('tablet')} prints the index: every app you've unlocked, one per line, with the verb that opens it.`,
  `You don't navigate it, you name it. <b>map</b> draws where you are, <b>bank</b> is your money, <b>gear</b> is what you're carrying and wearing, <b>quests</b> is what you've taken on, <b>codex</b> is what this city is and how it got that way, <b>calendar</b> is the date and your alarms.`,
  `<b>What you're meant to be doing.</b> ${cmdLink('quests')} lists every job you've accepted and what's still outstanding on each one, in order. When a line of the game leaves you wondering what comes next, that's the one to type. ${cmdLink('quest track', 'quest track &lt;name&gt;')} pins one so its route is the one being plotted.`,
  `<b>Being told where to go.</b> When a job wants you somewhere, the game plots a route to it and says how many stops away it is. You don't have to read a map to use it: type ${clientLink('auto')} and your character walks the route a step at a time, and ${clientLink('auto')} again stops. ${cmdLink('gps', 'gps &lt;place&gt;')} plots one to anywhere you can name. If a line ever tells you to hit AUTO or follow a green line, this is the thing it means.`,
  `${cmdLink('tablet verbs')} prints that list again at any moment, from anywhere, and works even if you go back to visual mode later.`,
];

function speakLogTabletTour(player) {
  out(player, `<span class="msg-system">— The tablet, in text. —</span>`);
  for (const line of LOG_TABLET_TOUR) out(player, `<span class="hint">${line}</span>`);
}

async function cmdTutorial(args, _raw, player) {
  const arg = (args[0] || '').toLowerCase();

  // Each of these is also the release valve on the held-back arrival prose (see
  // beginArrival): no tour → speak now, tour → speak when it ends. speakArrival
  // claims itself, so a replayed tutorial long after the fact is a no-op.
  if (arg === 'no') { // "yes, I've played text games" → never ask again
    await raise(player, F_TOUR_ASKED);
    speakArrival(player);
    return { type: 'system', message: `<span class="hint">Noted — no tour. Type <b>tutorial</b> any time if you want the interface walkthrough.</span>` };
  }
  if (arg === 'yes') { // they asked to be shown around
    await raise(player, F_TOUR_ASKED);
    // At the bottom rung nothing is running the tour but us — the client's
    // spotlight tour was never offered (see beginArrival). The prose still waits
    // for `done`, which the last line asks for.
    if (loggedPanelsSync(player)) { speakLogTour(player); return null; }
    return null; // the client is already running the tour; nothing to say — and the prose waits for `done`
  }
  if (arg === 'done') {
    await raise(player, F_TOUR_ASKED);
    await raise(player, F_TOUR_TAKEN);
    speakArrival(player);
    return { type: 'system', message: `<span class="hint">That's the interface. Everything else you learn by doing. (<b>help</b> lists the commands; <b>tutorial</b> replays this, <b>tutorial tablet</b> walks the tablet.)</span>` };
  }

  // `tutorial tablet` — the short walkthrough of the device, on its own. Fires
  // itself the first time the tablet is ever opened; this is the replay. No flag
  // raised: it isn't the interface tour and doesn't gate the arrival prose.
  if (arg === 'tablet') {
    if (loggedPanelsSync(player)) { speakLogTabletTour(player); return null; }
    sendToPlayer(player.id, { type: 'tour_tablet' });
    return null;
  }

  // Bare `tutorial` — replay it.
  await raise(player, F_TOUR_ASKED);
  if (loggedPanelsSync(player)) { speakLogTour(player); return null; }
  sendToPlayer(player.id, { type: 'tour_start' });
  return null;
}

// ── The cold open's two verbs ────────────────────────────────────────────────
// `introdone` is the client's echo, not something a player types (it's silent and
// harmless if they do). `intro` replays the sequence on demand — the same reason
// `tutorial` exists: a first impression you can't get back is a bad deal.
async function cmdIntroDone(args, _raw, player) {
  if (player?.current_zone === Z_INBETWEEN) await beginArrival(player);
  return null;
}

async function cmdIntro(args, _raw, player) {
  sendToPlayer(player.id, { type: 'intro_cinematic', skyline: coldwaterSkyline(), shore: coldwaterShore(),
    ...(loggedPanelsSync(player) ? { mode: 'log' } : {}) });
  return null;
}

// The client's echo when the tablet walkthrough ends — finished, skipped, or the
// chip in the bar ignored until it went away (25s, see smartbar.js). Like
// `introdone` it isn't something a player types, and is harmless if they do: the
// only thing it does is release the poster beat, which is flag- and zone-guarded.
// Everything about the walkthrough itself is client-side; this is the one wire back.
async function cmdTabletDone(args, _raw, player) {
  if (player?.current_zone === Z_CLONEVAT) await pointAtAdvert(player);
  return null;
}

export const commands = {
  tutorial: cmdTutorial,
  introdone: cmdIntroDone,
  intro: cmdIntro,
  tabletdone: cmdTabletDone,
};

// Test surface for plugins/prologue/regress.js (never used in production).
export const _test = {
  prologueMoveGate, useHolosign, useHolocaster, readHolosign,
  grantAllStatsPlusOne, isSet, raise,
  Z_INBETWEEN, Z_LATTICE, Z_BROADCAST, Z_COLLAPSE,
  ITEM_HOLOCASTER,
  F_ALIGNED, F_INTERFACED, F_BROADCAST, F_COLLAPSE, F_PLAYED,
  cmdTutorial, F_TOUR_ASKED, F_TOUR_TAKEN, LOG_TOUR, LOG_TABLET_TOUR,
  coldwaterSkyline, coldwaterShore, speakArrival, readTwocellAdvert, Z_CLONEVAT,
  cmdTabletDone, pointAtAdvert, autoReadAdvert, F_ADVERT, F_ADVERT_READ, F_TABLET,
};

console.log('[prologue] Plugin loaded.');
