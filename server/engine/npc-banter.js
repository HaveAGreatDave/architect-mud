// server/engine/npc-banter.js
//
// Ambient NPC-to-NPC conversations. When two or more idle NPCs share a zone
// and someone is around to witness it (a player in the room, or a live camera
// feeding a channel with viewers), they occasionally strike up a short, scripted
// back-and-forth. The exchange is picked from an editable library so it reads as
// a coherent little scene rather than two unrelated one-liners.
//
// Content lives in the DB, not this file:
//   • Shared library — table `npc_banter_threads`, loaded here into `library`
//     via loadBanterLibrary() (at boot and after edits in the dev panel). Rows
//     with no personality are generic (fit any pair); a personality slug limits
//     a thread to that archetype's initiator.
//   • Per-NPC scripts — `npc.banter` (array of threads); an NPC's own scripts
//     join the candidate pool when it starts a scene.
// Seed the shared library once with `node server/models/temp/seed-banter.js`.
//
// A "thread" is an ordered array of turn strings; turn i is spoken by
// participant[i % participants.length], so a 2-NPC scene alternates A/B/A/B.
// Turn convention matches chitchat: "quoted" → say bubble, unquoted → emote.
// Never while a participant is working, dead, in combat, or mid-shop, and only
// when the room has a witness — re-checked before every turn.

import { world } from './world.js';
import { query } from '../models/db.js';
import { isNpcScheduledNow, isZoneWatched } from './broadcast-bridge.js';
import { formatChitchat, isNpcAsleep } from './ai-behaviour.js';
import { getEnvironmentState } from './environment.js';
import { dispatchAction } from './actions.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const START_CHANCE    = 0.33;          // per eligible zone, per initiation tick
const TURN_GAP_MS      = [4500, 8000]; // random delay between turns
const ZONE_COOLDOWN_MS = [2, 4];       // minutes of quiet after a scene ends (min..max)
const MAX_TURNS        = 8;            // cap however long a chosen thread runs
const OWN_POOL_BIAS    = 0.7;          // chance to draw from per-NPC + personality pool over generic

// ── Shared library (loaded from DB) ───────────────────────────────────────────
// { generic: [thread], byPersonality: { slug: [thread] } } where thread = [line].
let library = { generic: [], byPersonality: {} };

export async function loadBanterLibrary() {
  const next = { generic: [], byPersonality: {} };
  try {
    const { rows } = await query('SELECT personality, lines, enabled FROM npc_banter_threads ORDER BY sort_order, id');
    for (const row of rows) {
      if (row.enabled === false) continue;
      const lines = Array.isArray(row.lines) ? row.lines : [];
      if (!lines.length) continue;
      const slug = row.personality || '';
      if (slug) (next.byPersonality[slug] ||= []).push(lines);
      else next.generic.push(lines);
    }
  } catch {
    // Table may not exist yet (schema not applied) — leave the library empty.
  }
  library = next;
}

// ── Active scenes ─────────────────────────────────────────────────────────────
// zoneId → { participants:[npcId], turns:[str], index, timer } while a scene runs.
const activeScenes = new Map();
// zoneId → timestamp; no new scene starts before this.
const zoneCooldown = new Map();

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// An NPC that can currently take part in idle banter.
function isEligible(npc, zoneId) {
  return npc
    && !npc._dead
    && npc.zone_id === zoneId
    && !npc.flags?.no_banter
    && !npc._combatTargetId
    && !npc._ai?.shopPaused
    && !npc._ai?.vendor_was_working
    // A sleeper holds no conversations. This was the loudest tell that the
    // banter pass and the sleep model didn't know about each other: two NPCs
    // homed in the same apartment would lie there at 4am running a scripted
    // two-hander at each other, and a player standing in the doorway watched a
    // room of sleeping people chat.
    && !isNpcAsleep(npc)
    && !isNpcScheduledNow(npc.id);
}

// Someone is around to witness a scene in this zone.
function hasWitness(zoneId) {
  const zone = world.zones.get(zoneId);
  if (zone && zone.players.size > 0) return true;
  return isZoneWatched(zoneId);
}

// Exported because "an NPC who is idle in this room right now" is not a banter
// question — ambient-life asks it too, to pick the person a {npc} vignette line
// is about. One predicate, so a sleeping or on-shift NPC is never picked to
// crouch over a bootlace in the street for the same reasons they never banter.
export function eligibleNpcs(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return [];
  const out = [];
  for (const id of zone.npcs) {
    const npc = world.npcs.get(id);
    if (isEligible(npc, zoneId)) out.push(npc);
  }
  return out;
}

// ── Topical tokens (weather & sports) ──────────────────────────────────────────
// Banter lines may embed {tokens} that resolve to live world state, so idle chatter
// reacts to the day's weather and the DEADBALL standings. Tokens are snapshotted ONCE
// when a scene starts, so a multi-turn exchange stays internally consistent. A thread
// that references a token with no data right now (e.g. a sports line before any game
// has been played, or a wind line on a calm day) is skipped in favour of a plain one —
// so topical lines only air when the thing they're about is actually happening.
const HAS_TOKEN = /\{[a-z_]+\}/;
const TOKEN_RE  = /\{([a-z_]+)\}/g;

// Casual words an NPC would actually use for each forecast type.
const WEATHER_WORD = {
  clear: 'clear skies', cloudy: 'this grey sky', overcast: 'this gloom',
  rain: 'this rain', sleet: 'this sleet', thunderstorm: 'this storm',
  storm: 'this wind', snow: 'the snow', blizzard: 'this blizzard',
  fog: 'this fog', haze: 'the haze', ash: 'the ashfall',
};

// Snapshot the live values behind every supported token. Values that aren't
// meaningful right now are left unset so threads that need them get skipped:
//   • wind is unset on a calm day (so "wind's doing {wind}" only airs when it is)
//   • sports tokens are unset until games have been played
async function getTopicContext() {
  const tokens = {};
  try {
    const env = getEnvironmentState();
    if (env) {
      tokens.weather = WEATHER_WORD[env.weatherType] || 'the weather';
      tokens.temp = `${Math.round(env.feelsLikeC ?? env.tempC ?? 0)}°`;
      const wind = Math.round(env.windKph ?? 0);
      if (wind >= 5) tokens.wind = `${wind} kph`;
    }
  } catch { /* environment not ready — weather tokens stay unset */ }
  try {
    const res = await dispatchAction({ type: 'sportsleague.getStandings' });
    const rows = Array.isArray(res?.rows) ? res.rows : [];
    if (rows.length) {
      tokens.sports_leader = rows[0].team;
      tokens.sports_record = `${rows[0].wins}-${rows[0].losses}`;
      if (rows.length >= 2) tokens.sports_cellar = rows[rows.length - 1].team;
    }
  } catch { /* sportsleague plugin absent — sports tokens stay unset */ }
  return tokens;
}

// Substitute a thread's tokens against the snapshot. Returns the resolved lines, or
// null if the thread references a token with no current value (caller picks another).
function resolveThread(thread, tokens) {
  let ok = true;
  const out = thread.map(line => line.replace(TOKEN_RE, (m, key) => {
    const v = tokens[key];
    if (v == null) { ok = false; return m; }
    return v;
  }));
  return ok ? out : null;
}
const threadHasTokens = (thread) => thread.some(line => HAS_TOKEN.test(line));

// Pick a thread for a scene the initiator starts. Biased toward the initiator's
// own scripts + its personality's flavour threads; falls back to the generic pool.
function pickThread(initiator) {
  const own = Array.isArray(initiator.banter) ? initiator.banter.filter(t => Array.isArray(t) && t.length) : [];
  const persona = initiator.flags?.personality;
  const flavour = persona ? (library.byPersonality[persona] || []) : [];
  const ownPool = [...own, ...flavour];
  const generic = library.generic;

  if (ownPool.length && (!generic.length || Math.random() < OWN_POOL_BIAS)) return rand(ownPool);
  if (generic.length) return rand(generic);
  return ownPool.length ? rand(ownPool) : null;
}

function endScene(zoneId) {
  const scene = activeScenes.get(zoneId);
  if (scene?.timer) clearTimeout(scene.timer);
  activeScenes.delete(zoneId);
  zoneCooldown.set(zoneId, Date.now() + randInt(ZONE_COOLDOWN_MS[0], ZONE_COOLDOWN_MS[1]) * 60_000);
}

// Emit one turn, then schedule the next — re-validating the scene each time.
function runTurn(zoneId, broadcast) {
  const scene = activeScenes.get(zoneId);
  if (!scene) return;

  // Abort if nobody's watching anymore, or the scene has run its course.
  if (scene.index >= scene.turns.length || !hasWitness(zoneId)) return endScene(zoneId);

  const speaker = world.npcs.get(scene.participants[scene.index % scene.participants.length]);
  // Abort if the speaker wandered off, clocked in, died, or entered combat.
  if (!isEligible(speaker, zoneId)) return endScene(zoneId);

  broadcast(zoneId, formatChitchat(speaker.name, scene.turns[scene.index]));
  if (speaker._ai) speaker._ai.lastSay = Date.now(); // share chitchat cooldown so they don't double-talk
  scene.index++;

  if (scene.index >= scene.turns.length) return endScene(zoneId);
  scene.timer = setTimeout(() => runTurn(zoneId, broadcast), randInt(TURN_GAP_MS[0], TURN_GAP_MS[1]));
}

async function startScene(zoneId, npcs, broadcast) {
  // Two speakers keeps the exchange coherent; alternate A/B/A/B.
  const shuffled = [...npcs].sort(() => Math.random() - 0.5);
  const initiator = shuffled[0];

  // Pick a thread. Topical threads resolve their {tokens} against a one-time weather/
  // sports snapshot; if the data isn't there right now, try again for a plain thread.
  let turns = null, tokens = null;
  for (let attempt = 0; attempt < 5 && !turns; attempt++) {
    const thread = pickThread(initiator);
    if (!thread) break;                                   // nothing authored yet
    if (!threadHasTokens(thread)) { turns = thread; break; }
    if (!tokens) tokens = await getTopicContext();        // fetch once, lazily
    turns = resolveThread(thread, tokens);                // null → unresolvable, loop
  }

  // The reservation may have been cleared while we awaited (zone emptied, etc.).
  if (!activeScenes.get(zoneId)?.pending) return;
  if (!turns) { endScene(zoneId); return; }
  if (eligibleNpcs(zoneId).length < 2 || !hasWitness(zoneId)) { endScene(zoneId); return; }

  const participants = shuffled.slice(0, 2).map(n => n.id);
  activeScenes.set(zoneId, { participants, turns: turns.slice(0, MAX_TURNS), index: 0, timer: null });
  runTurn(zoneId, broadcast);
}

// Initiation tick (scheduled). Scans witnessed zones and occasionally kicks off
// a scene where two idle NPCs share the room. Turn-by-turn pacing is handled by
// the per-scene timers above; this only decides when a scene begins.
export function npcBanterTick({ broadcast }) {
  const now = Date.now();
  // Only consider zones that currently have a witness. Player zones come free
  // from world.players; camera-watched zones are checked per candidate below.
  const candidateZones = new Set();
  for (const player of world.players.values()) {
    if (player.current_zone) candidateZones.add(player.current_zone);
  }
  for (const zoneId of activeScenes.keys()) candidateZones.add(zoneId); // let running scenes wind down naturally

  for (const zoneId of candidateZones) {
    if (activeScenes.has(zoneId)) continue;                 // one scene per zone
    if ((zoneCooldown.get(zoneId) ?? 0) > now) continue;    // resting
    if (!hasWitness(zoneId)) continue;
    if (Math.random() > START_CHANCE) continue;
    const npcs = eligibleNpcs(zoneId);
    if (npcs.length < 2) continue;
    // Reserve the zone synchronously so a second tick can't double-start while
    // startScene awaits its topical snapshot; startScene fills or clears the slot.
    activeScenes.set(zoneId, { pending: true, participants: [], turns: [], index: 0, timer: null });
    startScene(zoneId, npcs, broadcast).catch(() => endScene(zoneId));
  }
}
