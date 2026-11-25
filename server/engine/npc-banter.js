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
import { getEnvironmentState, getZoneWeatherType, isIndoorZone } from './environment.js';
import { dispatchAction } from './actions.js';
import { randInt } from './util.js';
import { emit } from './events.js';
import { getRelation } from './relations.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const START_CHANCE    = 0.33;          // per eligible zone, per initiation tick
const TURN_GAP_MS      = [2500, 4000]; // random delay between turns
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

// ── Topical tokens (weather, sports & television) ─────────────────────────────
// Banter lines may embed {tokens} that resolve to live world state, so idle chatter
// reacts to the day's weather, the DEADBALL standings, and whatever is on the set in
// the room the scene is happening in. Tokens are snapshotted ONCE
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
//   • tv tokens are unset in a room with no set on, which is most rooms — so a
//     thread about what's on the screen can only ever air in front of a screen,
//     and nobody argues about the ball game in an empty stairwell
async function getTopicContext(zoneId) {
  const tokens = {};
  try {
    const env = getEnvironmentState();
    if (env) {
      // Out on a street it is the sky over that tile: rain only falls under a cell, and two people
      // complaining about 'this rain' in a dry street read as a bug. Indoors they mean the city's day.
      const z = world.zones.get(zoneId);
      const wx = z && !isIndoorZone(z) ? getZoneWeatherType(zoneId) : env.weatherType;
      tokens.weather = WEATHER_WORD[wx] || 'the weather';
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
  // Both leagues' own clubs and a score drawn from their real records:
  // {deadball_winner} beat {deadball_loser} {deadball_score}, and the puck_ set alike.
  for (const [sport, pre] of [['baseball', 'deadball'], ['hockey', 'puck']]) {
    try {
      const res = await dispatchAction({ type: 'sportsleague.getStandings', params: { sport } });
      Object.assign(tokens, drawnGame(Array.isArray(res?.rows) ? res.rows : [], sport, pre));
    } catch { /* no league — that sport's tokens stay unset */ }
  }
  try {
    // What's on the screen in THIS room. Via the action registry rather than an
    // import: broadcast is a plugin and the engine must not reach into one.
    const tv = await dispatchAction({ type: 'broadcast.getZoneNowPlaying', params: { zoneId } });
    if (tv?.channelId) {
      if (tv.program)     tokens.tv_program = tv.program;
      if (tv.stationName) tokens.tv_station = tv.stationName;
      if (tv.number != null) tokens.tv_channel = String(tv.number);
    }
  } catch { /* broadcast plugin absent — tv tokens stay unset */ }
  return tokens;
}

// A game between two of a league's clubs, its score drawn from their records: each side
// scores around the mean of its own scoring rate and the other's conceding rate. Unset
// until both clubs have played. Deadball can't tie; a tied puck game goes to overtime.
function poisson(mean) {
  const L = Math.exp(-Math.max(0.2, mean));
  let k = 0, p = Math.random();
  while (p > L && k < 20) { k++; p *= Math.random(); }
  return k;
}
function drawnGame(rows, sport, pre) {
  const played = rows.filter(r => (r.wins || 0) + (r.losses || 0) + (r.otl || 0) > 0);
  if (played.length < 2) return {};
  const a = rand(played);
  const b = rand(played.filter(r => r !== a));
  const hockey = sport === 'hockey';
  const rate = (r, k) => (r[hockey ? `goals_${k}` : `runs_${k}`] || 0) / ((r.wins || 0) + (r.losses || 0) + (r.otl || 0));
  let sa = poisson((rate(a, 'for') + rate(b, 'against')) / 2);
  let sb = poisson((rate(b, 'for') + rate(a, 'against')) / 2);
  let ot = false;
  if (sa === sb) {
    ot = hockey;
    // the better record takes the extra run, or the overtime winner
    if ((a.wins || 0) - (a.losses || 0) >= (b.wins || 0) - (b.losses || 0)) sa++; else sb++;
  }
  const [w, l, ws, ls] = sa > sb ? [a, b, sa, sb] : [b, a, sb, sa];
  const rec = r => hockey ? `${r.wins}-${r.losses}-${r.otl || 0}` : `${r.wins}-${r.losses}`;
  return {
    [`${pre}_team`]: a.team, [`${pre}_team_record`]: rec(a),
    [`${pre}_rival`]: b.team, [`${pre}_rival_record`]: rec(b),
    [`${pre}_winner`]: w.team, [`${pre}_loser`]: l.team,
    [`${pre}_winner_record`]: rec(w), [`${pre}_loser_record`]: rec(l),
    [`${pre}_score`]: `${ws}-${ls}${ot ? ' in overtime' : ''}`,
  };
}

// Substitute a thread's tokens against the snapshot. Returns the resolved lines, or
// null if the thread references a token with no current value (caller picks another).
function resolveThread(thread, tokens) {
  let ok = true;
  const out = thread.map(line => line.replace(TOKEN_RE, (m, key) => {
    if (PER_TURN.has(key)) return m;
    const v = tokens[key];
    if (v == null) { ok = false; return m; }
    return v;
  }));
  return ok ? out : null;
}
const threadHasTokens = (thread) => thread.some(line => HAS_TOKEN.test(line));

// ── Frames (registered by content) ────────────────────────────────────────────
// The lines round a thread: openers by how well the pair knows each other, callbacks
// to their last talk, closers, a third person's interjection, and asides about a
// stranger in the room. The engine knows the shape; a game registers the words
// (Architect's are plugins/ambient-life/banter-frames.js). Empty = threads play bare.
let frames = { openers: {}, callbacks: [], closers: [], interjections: [], asides: [] };
export function registerBanterFrames(f) { frames = { ...frames, ...(f || {}) }; }

const OPENER_CHANCE   = 0.6;
const CALLBACK_CHANCE = 0.35;   // of opening on the last talk, for a pair that's had one
const CLOSER_CHANCE   = 0.5;
const INTERJECT_CHANCE = 0.25;  // a third idle NPC in the room says something after
const ASIDE_CHANCE    = 0.15;   // a witness neither of them knows gets looked at first
const RECENT_PER_PAIR = 8;      // threads a pair won't repeat
const PAIR_MEMORY_MS  = 12 * 3600_000;

// ── Pair memory (RAM only) ────────────────────────────────────────────────────
// pairKey → { talks, recent:[thread], at }. Forgotten on restart, like home-talk's.
const pairs = new Map();
const pairKey = (a, b) => [a, b].sort().join(':');
function pairMemory(a, b) {
  const k = pairKey(a, b);
  let m = pairs.get(k);
  if (m && Date.now() - m.at > PAIR_MEMORY_MS) m = null;
  if (!m) pairs.set(k, m = { talks: 0, recent: [], at: Date.now() });
  return m;
}
const acquaintance = (talks) => talks === 0 ? 'stranger' : talks < 4 ? 'known' : 'regular';

// Pick a thread for a scene the initiator starts. Biased toward the initiator's
// own scripts + its personality's flavour threads; falls back to the generic pool.
// A pair doesn't repeat a thread it has had recently, while there's anything else.
function pickThread(initiator, avoid = []) {
  const own = Array.isArray(initiator.banter) ? initiator.banter.filter(t => Array.isArray(t) && t.length) : [];
  const persona = initiator.flags?.personality;
  const flavour = persona ? (library.byPersonality[persona] || []) : [];
  const fresh = (pool) => { const f = pool.filter(t => !avoid.includes(t)); return f.length ? f : pool; };
  const ownPool = fresh([...own, ...flavour]);
  const generic = fresh(library.generic);

  if (ownPool.length && (!generic.length || Math.random() < OWN_POOL_BIAS)) return rand(ownPool);
  if (generic.length) return rand(generic);
  return ownPool.length ? rand(ownPool) : null;
}

// A frame's lines with the topical tokens filled; {me}/{you}/{third} wait for the turn.
const PER_TURN = new Set(['me', 'you', 'third']);
function resolveFrame(lines, tokens) {
  let ok = true;
  const out = lines.map(line => line.replace(TOKEN_RE, (m, key) => {
    if (PER_TURN.has(key)) return m;
    const v = tokens?.[key];
    if (v == null) { ok = false; return m; }
    return v;
  }));
  return ok ? out : null;
}
function pickFrame(pool, tokens) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const order = [...pool].sort(() => Math.random() - 0.5);
  for (const f of order) { const r = resolveFrame(Array.isArray(f) ? f : [f], tokens); if (r) return r; }
  return null;
}
const firstName = (npc) => String(npc?.name || 'someone').split(' ')[0];
function personalise(line, speaker, other, third) {
  return line.replace(/\{(me|you|third)\}/g, (m, k) =>
    k === 'me' ? firstName(speaker) : k === 'you' ? firstName(other) : firstName(third || other));
}

function endScene(zoneId) {
  const scene = activeScenes.get(zoneId);
  if (scene?.timer) clearTimeout(scene.timer);
  activeScenes.delete(zoneId);
  if (scene?.participants?.length) emit('npc.banter.end', { zoneId, participants: scene.participants });
  // A finished scene can draw a remark from somebody else in the room who heard it.
  if (scene?.finished && scene.broadcast && Math.random() < INTERJECT_CHANCE && hasWitness(zoneId)) {
    const others = eligibleNpcs(zoneId).filter(n => !scene.participants.includes(n.id));
    const line = others.length ? pickFrame(frames.interjections, scene.tokens) : null;
    if (line) {
      const who = rand(others);
      const target = world.npcs.get(rand(scene.participants));
      setTimeout(() => {
        if (!isEligible(who, zoneId) || !hasWitness(zoneId)) return;
        scene.broadcast(zoneId, formatChitchat(who, personalise(line[0], who, target, target), { kind: 'banter' }));
        if (who._ai) who._ai.lastSay = Date.now();
      }, randInt(TURN_GAP_MS[0], TURN_GAP_MS[1]));
    }
  }
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

  const other = world.npcs.get(scene.participants[(scene.index + 1) % scene.participants.length]);
  broadcast(zoneId, formatChitchat(speaker, personalise(scene.turns[scene.index], speaker, other), { kind: 'banter' }));
  if (speaker._ai) speaker._ai.lastSay = Date.now(); // share chitchat cooldown so they don't double-talk
  scene.index++;

  if (scene.index >= scene.turns.length) { scene.finished = true; return endScene(zoneId); }
  scene.timer = setTimeout(() => runTurn(zoneId, broadcast), randInt(TURN_GAP_MS[0], TURN_GAP_MS[1]));
}

async function startScene(zoneId, npcs, broadcast) {
  // Two speakers keeps the exchange coherent; alternate A/B/A/B.
  const shuffled = [...npcs].sort(() => Math.random() - 0.5);
  const initiator = shuffled[0];
  const partner = shuffled[1];
  const memory = pairMemory(initiator.id, partner.id);

  // Pick a thread. Topical threads resolve their {tokens} against a one-time weather/
  // sports snapshot; if the data isn't there right now, try again for a plain thread.
  let turns = null, tokens = null, chosen = null;
  for (let attempt = 0; attempt < 5 && !turns; attempt++) {
    const thread = pickThread(initiator, memory.recent);
    if (!thread) break;                                   // nothing authored yet
    chosen = thread;
    if (!threadHasTokens(thread)) { turns = thread; break; }
    if (!tokens) tokens = await getTopicContext(zoneId);   // fetch once, lazily
    turns = resolveThread(thread, tokens);                // null → unresolvable, loop
  }

  // Frame it by how well these two know each other. Every frame piece is two lines,
  // so the thread still opens on the initiator. Frames read the snapshot if there is one.
  if (turns) {
    const head = [];
    const strangerHere = [...(world.zones.get(zoneId)?.players || [])].some(pid => {
      const p = world.players.get(pid);
      return p && !getRelation(p, initiator.id).met_at && !getRelation(p, partner.id).met_at;
    });
    if (strangerHere && Math.random() < ASIDE_CHANCE) head.push(...(pickFrame(frames.asides, tokens) || []));
    if (memory.talks > 0 && Math.random() < CALLBACK_CHANCE) head.push(...(pickFrame(frames.callbacks, tokens) || []));
    else if (Math.random() < OPENER_CHANCE) head.push(...(pickFrame(frames.openers?.[acquaintance(memory.talks)], tokens) || []));
    const tail = Math.random() < CLOSER_CHANCE ? (pickFrame(frames.closers, tokens) || []) : [];
    const body = turns.slice(0, MAX_TURNS);
    turns = [...head, ...body, ...tail];
  }

  // The reservation may have been cleared while we awaited (zone emptied, etc.).
  if (!activeScenes.get(zoneId)?.pending) return;
  if (!turns) { endScene(zoneId); return; }
  if (eligibleNpcs(zoneId).length < 2 || !hasWitness(zoneId)) { endScene(zoneId); return; }

  const participants = [initiator.id, partner.id];
  memory.talks++; memory.at = Date.now();
  if (chosen) { memory.recent.push(chosen); if (memory.recent.length > RECENT_PER_PAIR) memory.recent.shift(); }
  activeScenes.set(zoneId, { participants, turns, index: 0, timer: null, broadcast, tokens });
  // the Room Stage turns them to face each other (plugins/roomstage/npc-life.js)
  emit('npc.banter.start', { zoneId, participants });
  runTurn(zoneId, broadcast);
}

// For another conversation layer (plugins/ambient-life/home-talk.js): is a generic scene running here,
// and hold the zone quiet for `ms` so one doesn't start over the top of theirs.
export const isBanterBusy = (zoneId) => activeScenes.has(zoneId);
export function holdBanterZone(zoneId, ms) {
  zoneCooldown.set(zoneId, Math.max(zoneCooldown.get(zoneId) ?? 0, Date.now() + ms));
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
