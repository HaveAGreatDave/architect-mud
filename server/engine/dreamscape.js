/**
 * Dreamscape — the experiences you can be put inside.
 *
 * Two causes, one mechanism. A sleep DREAM (rolled in the sleep tick) and a drug
 * HALLUCINATION (rolled by plugins/trip) both build the same thing: a small set of
 * private, RAM-only rooms you can walk, look at and talk in, which dissolve the
 * moment the cause ends. Built on `registerTransientZone` — the same non-DB room
 * mechanism the void crossings use — so an instance costs no schema and no cleanup
 * beyond forgetting it.
 *
 * INSTANCED, ALWAYS. The rooms are keyed by player id, so two people dreaming (or
 * tripping on the same drug) never share a room. This is the whole difference from
 * the old authored drug dreamzones, where two players on the same drug stood in
 * the same room and could see each other.
 *
 * CONTENT, NOT CODE. Rooms come from `dream_templates` and the wandering figure
 * from `dream_presences`, both authored in the dev panel. `cause` ('dream'|'drug')
 * plus `drug_id` decides what a given experience can draw from — see the fallback
 * chain in loadTemplates(). readTier is COLD on purpose: the query happens once per
 * instance, only when an experience actually fires, never on a per-tick path. There
 * is no cache and therefore nothing to invalidate.
 *
 * THE RULES ARE WRONG ON PURPOSE. Exits don't reciprocate, objects read differently
 * each time you look, and the geography doesn't close. The player should work out
 * within a room or two that this place does not obey the things the rest of the
 * game has taught them.
 *
 * See docs/systems-dreams.md.
 */
import { query } from '../models/db.js';
import { registerTransientZone, removeTransientZone, world, addPlayerToZone, removePlayerFromZone } from './world.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const maybe = (p) => Math.random() < p;

export const DREAM_ZONE_PREFIX = 'zone_dream_';

const DIRS = ['north', 'south', 'east', 'west', 'up', 'down', 'in', 'out'];

// How often the wandering figure reconsiders where it is. One timer per active
// instance, cleared on dissolve and self-cancelling if the occupant vanishes — so
// this stays proportional to people currently dreaming, not to players. Room
// ambience is NOT on this timer; it rides the engine's scheduled ambientTick (see
// beat() for why).
const BEAT_MS = 14000;

// instanceKey -> { playerId, roomIds, presence, presenceRoom, timer, broadcast }
const instances = new Map();

/**
 * Rooms this experience may draw from.
 *
 * A dream draws from the single shared 'dream' pool. A drug walks a fallback chain
 * so a new hallucinogen is never blocked on someone authoring rooms for it first:
 *
 *   1. templates for THIS drug
 *   2. the default drug set (cause='drug', drug_id IS NULL)
 *   3. nothing — the caller downgrades (trip falls back to its overlay mode)
 *
 * Fallback, NOT blend: a drug with its own rooms never gets the generic ones mixed
 * in, or scoping by drug_id would have been pointless.
 */
async function loadTemplates(cause, drugId) {
  if (cause === 'drug') {
    if (drugId) {
      const { rows } = await query(
        `SELECT * FROM dream_templates WHERE cause='drug' AND drug_id=$1`, [drugId]);
      if (rows.length) return rows;
    }
    const { rows } = await query(
      `SELECT * FROM dream_templates WHERE cause='drug' AND drug_id IS NULL`);
    return rows;
  }
  const { rows } = await query(`SELECT * FROM dream_templates WHERE cause='dream'`);
  return rows;
}

/** The wandering figure for this experience, or null if none is authored. */
async function loadPresence(cause, drugId) {
  if (cause === 'drug' && drugId) {
    const { rows } = await query(
      `SELECT * FROM dream_presences WHERE cause='drug' AND drug_id=$1`, [drugId]);
    if (rows.length) return pick(rows);
  }
  const { rows } = await query(
    `SELECT * FROM dream_presences WHERE cause=$1 AND drug_id IS NULL`, [cause]);
  return rows.length ? pick(rows) : null;
}

const asList = (v) => (Array.isArray(v) ? v : []);

// ── Tethers: what a dream borrows from your actual life ─────────────────────
//
// The old version was one hardcoded sentence naming the zone you were lying in.
// This keeps that and adds the people you know, the things in your pockets, and
// how you last died — but the important part is the MIX.
//
// A dream that is relentlessly about you is exactly as predictable as one that
// never is. So: most rooms get no tether at all and simply stand on their own
// prose; of those that do, a decent share hook onto NOTHING and are merely
// strange. The personal ones land harder for being outnumbered.
const TETHER_CHANCE = 0.55;   // rooms that get any tether line at all
const PERSONAL_SHARE = 0.6;   // ...of those, how many are about you

/**
 * Facts about this player a dream can borrow. Two queries, once per instance, on
 * the cold path — relations and the body zone are already in memory.
 *
 * Every lookup is best-effort: a player with no relations, an empty inventory and
 * no deaths simply offers fewer kinds, and the roll falls back to an impersonal
 * line rather than producing a sentence with a hole in it.
 */
async function gatherTetherFacts(player) {
  const facts = {};
  try {
    const bodyZone = player?.sleeping?.bodyZone || player?._bodyZone || player?.current_zone;
    const z = bodyZone && world.zones.get(bodyZone);
    if (z?.name) facts.zone = z.name;

    // Relations are hydrated at login and read from memory — never a query here
    // (getRelation is sync by contract; see relations.js).
    const rels = player?._relations;
    if (rels?.size) {
      const known = [...rels.entries()]
        .filter(([, r]) => (Number(r?.familiarity) || 0) >= 3)
        .map(([npcId]) => world.npcs?.get(npcId)?.name)
        .filter(Boolean);
      if (known.length) facts.npc = pick(known);
    }

    const [inv, deaths] = await Promise.all([
      query(`SELECT i.name FROM player_inventory pi JOIN items i ON i.id=pi.item_id
             WHERE pi.player_id=$1 AND pi.container_id IS NULL ORDER BY random() LIMIT 1`, [player.id]),
      query(`SELECT cause_label FROM player_deaths WHERE player_id=$1 ORDER BY real_ts DESC LIMIT 1`, [player.id]),
    ]);
    if (inv.rows[0]?.name) facts.item = inv.rows[0].name;

    // `cause_label` is a whole sentence ("Killed by a dog", "Died in a
    // hallucination"), so pasting it in raw reads as a database string stapled to
    // the end of a line. Pull the AGENT out of it instead — "a dog", "Cyd" — which
    // is the part a dream would actually be about, and which drops into a sentence
    // without looking like a log entry. Labels with no agent (starvation, a fall,
    // "Unknown causes") offer no death fact at all rather than an awkward one.
    const label = deaths.rows[0]?.cause_label || '';
    const agent = label.match(/^Killed by[:\s]+(.+?)\.?$/i)?.[1]?.trim();
    if (agent) facts.death = agent;
  } catch (e) {
    console.error('[dreamscape] tether facts:', e.message);
  }
  return facts;
}

/**
 * One tether sentence for a room, or '' — see the mix note above.
 *
 * `used` is a Set shared across the rooms of ONE instance. Without it a four-room
 * dream can hand you the same sentence twice, which is the fastest possible way
 * to make an authored pool feel small — a repeat inside a single dream is far
 * more noticeable than the same line turning up a week later.
 */
function rollTether(tethers, facts, used = new Set()) {
  if (!tethers.length || !maybe(TETHER_CHANCE)) return '';
  const personalKinds = Object.keys(facts);
  const wantPersonal = personalKinds.length && maybe(PERSONAL_SHARE);
  const kind = wantPersonal ? pick(personalKinds) : 'none';
  // Prefer lines this dream has not used yet; fall back to the whole pool only
  // when every one of them has already appeared.
  const all = tethers.filter(t => t.kind === kind);
  if (!all.length) return '';
  const fresh = all.filter(t => !used.has(t.id));
  const chosen = pick(fresh.length ? fresh : all);
  const line = chosen.line || '';
  // A line whose fact is missing would print "{value}" at the player. Drop it
  // rather than paper over it — a silent no-tether reads as intentional.
  if (/\{value\}/.test(line) && !facts[kind]) return '';
  used.add(chosen.id);
  return ` ${line.replace(/\{value\}/g, facts[kind] || '')}`;
}

/**
 * Build an instance and return its entry zone id, or NULL if no templates exist
 * for this cause — callers must handle null rather than assume a room.
 *
 * Async because it reads content. Callers: the sleep tick and plugins/trip, both
 * already async.
 */
export async function buildDreamscape(playerId, {
  size = 3, tether = {}, cause = 'dream', drugId = null, broadcast = null, player = null,
} = {}) {
  const templates = await loadTemplates(cause, drugId);
  if (!templates.length) return null;

  // Tethers are optional: a caller with no player object (regress, the devpanel
  // preview) simply gets untethered rooms.
  const { rows: tethers } = await query(`SELECT * FROM dream_tethers`);
  const facts = player ? await gatherTetherFacts(player) : {};
  // One Set for the whole instance, so no line repeats inside a single dream.
  const usedTethers = new Set();
  // Legacy caller shape: a bare { zone } still works as the zone fact.
  if (!facts.zone && tether?.zone) facts.zone = tether.zone;

  // A THIN POOL SHRINKS THE DREAM RATHER THAN REPEATING ITSELF.
  //
  // Drawing `size` rooms from two templates used to hand back the same room twice,
  // which reads as a bug rather than as a dream. Capping the instance at the pool
  // size means a two-template drug gives a short, coherent two-room experience —
  // smaller, never repetitive, and it degrades gracefully as content is added
  // rather than needing a minimum before it looks right.
  //
  // The alternative (topping up from the default set) was rejected: it would
  // dilute an authored K-hole with generic rooms and undo the point of scoping by
  // drug at all. The editor warns on a thin pool; this makes a thin pool merely
  // short instead of broken.
  const pool = [...templates].sort(() => Math.random() - 0.5);
  size = Math.max(1, Math.min(size, pool.length));

  const stamp = `${DREAM_ZONE_PREFIX}${playerId}_${Date.now().toString(36)}`;
  const ids = Array.from({ length: size }, (_, i) => `${stamp}_${i}`);

  ids.forEach((id, i) => {
    const t = pool[i];   // size is capped to pool.length above, so never wraps
    // Exits lead onward, and sometimes to a room you have already been in — a
    // dream loops rather than branching.
    const exits = {};
    const outCount = 1 + (maybe(0.5) ? 1 : 0);
    const dirs = [...DIRS].sort(() => Math.random() - 0.5).slice(0, outCount);
    for (const d of dirs) exits[d] = pick(ids.filter(x => x !== id)) || id;

    // What this room borrows from the sleeper's real life — a person, a pocket,
    // a death, the room they are lying in, or nothing at all. Rolled PER ROOM, so
    // one dream naturally mixes the personal and the merely strange.
    const anchored = rollTether(tethers, facts, usedTethers);

    registerTransientZone({
      id,
      name: t.name,
      description: t.description + anchored,
      exits,
      // No light system in here: it is exactly as bright as it needs to be.
      flags: { is_interior: true, always_lit: true, dream: true, no_combat: true },
      ambient_events: asList(t.ambient),
      // Impossible weather for a room that is flagged interior and would otherwise
      // have none. describe.js renders this in the weather slot; it touches no
      // part of the weather sim, so gear and temperature are unaffected.
      dreamWeather: t.weather || null,
      // Particle field for the client FX canvas — pushed on arrival by pushDreamFx.
      dreamFx: t.fx ? { effect: t.fx, intensity: t.fx_intensity ?? 0.5 } : null,
      // One look per object per instance, so the same object reads differently
      // between experiences. An object that reads identically twice is furniture.
      dreamObjects: asList(t.objects).map(o => ({
        name: o.name,
        look: pick(asList(o.looks)) || 'You cannot afterwards say what it was.',
      })),
    });
  });

  const presence = await loadPresence(cause, drugId);
  const inst = {
    playerId, roomIds: ids, presence,
    presenceRoom: presence ? pick(ids) : null,
    broadcast, timer: null,
  };
  if (broadcast) inst.timer = setInterval(() => beat(inst), BEAT_MS);
  instances.set(stamp, inst);

  return ids[0];
}

/**
 * One beat of a live instance: the wandering figure moving.
 *
 * AMBIENCE IS NOT DONE HERE. The engine's scheduled `ambientTick` (gameLoop, 45s)
 * already walks `world.zones` — which includes transient rooms — and
 * `getRandomAmbient` already reads the `ambient_events` these rooms are built
 * with. It was being dropped only because `receivesZoneMessage` rejected a
 * sleeper; that now makes an exception for the dream they're inside. So the room's
 * atmosphere rides the existing idle-gated scheduler like every other room's, and
 * this timer exists solely for the one thing nothing else can do: move a figure
 * between rooms only one player can see.
 *
 * Sent targeted because an instance has exactly one occupant, so there is no
 * audience to compute.
 */
function beat(inst) {
  const player = world.players.get(inst.playerId);
  // SELF-CANCEL. Every known exit calls dissolveDreamscape, which clears this
  // timer — but "every known path" is exactly the assumption that has already been
  // wrong three times in this system. If the occupant is gone or is no longer in
  // any of our rooms, stop rather than ticking forever against a dead instance.
  if (!player || !inst.roomIds.includes(player.current_zone)) {
    if (inst.timer) { clearInterval(inst.timer); inst.timer = null; }
    return;
  }
  const send = (message) => inst.broadcast(null, { type: 'ambient', message: `<span class="msg-ambient">${message}</span>` }, null, inst.playerId);

  if (!inst.presence) return;
  // The figure wanders. You are told when it arrives where you are and when it
  // leaves — never where it went, because it never resolves into anything.
  if (maybe(0.45)) {
    const was = inst.presenceRoom;
    inst.presenceRoom = pick(inst.roomIds);
    if (inst.presenceRoom === was) return;
    if (was === player.current_zone) send(pick(asList(inst.presence.departures)) || 'You are alone again.');
    else if (inst.presenceRoom === player.current_zone) send(pick(asList(inst.presence.arrivals)) || 'Somebody is here.');
  }
}

/**
 * Push this room's particle field at whoever is standing in it.
 *
 * Called on entry and on every move WITHIN an instance — otherwise the field is
 * whatever the entry room happened to set and never changes as you walk, which
 * is worse than having none. Sending {effect:'none'} explicitly matters: it is
 * what puts the real weather back when a room has no field of its own.
 */
export function pushDreamFx(player, broadcast) {
  if (!broadcast || !player) return;
  const fx = world.zones.get(player.current_zone)?.dreamFx;
  broadcast(null, { type: 'dream_fx', ...(fx || { effect: 'none', intensity: 0 }) }, null, player.id);
}

/** Is this a dream/hallucination room? */
export const isDreamZone = (zoneId) => typeof zoneId === 'string' && zoneId.startsWith(DREAM_ZONE_PREFIX);

/**
 * How an absent body reads to the rest of the room, or null if they're present.
 *
 * The body-stays-put model means a person whose mind is elsewhere is standing
 * right there, lootable and killable — so the room MUST be told, or they read as
 * an ordinary alert player and nobody can tell the difference between a sleeper,
 * a tripper and someone about to fight back.
 *
 * Keyed on where the mind actually is rather than on `sleeping`, because a drug
 * trip has no `sleeping` object at all: for a tripper, `sleeping` is null and only
 * `current_zone` gives them away. Anything future that sends a mind elsewhere is
 * covered for free.
 */
export function bodyTell(player, roomId) {
  if (!player) return null;
  if (player.sleeping) return 'sleeping';
  if (isDreamZone(player.current_zone) && player.current_zone !== roomId) return 'glassy-eyed';
  return null;
}

/** Everything a player can poke at in the room they're standing in. */
export function dreamObjectsAt(zoneId) {
  return world.zones.get(zoneId)?.dreamObjects || [];
}

/**
 * The wandering figure, if it is currently in this room — so `examine` can answer
 * for it. Returns null when it is elsewhere, which is most of the time.
 */
export function presenceAt(zoneId) {
  for (const inst of instances.values()) {
    if (inst.presence && inst.presenceRoom === zoneId && inst.roomIds.includes(zoneId)) {
      return { name: inst.presence.name, looks: asList(inst.presence.looks) };
    }
  }
  return null;
}

/**
 * Yank a player out, wherever it happened from.
 *
 * There are SEVEN places an experience can end — waking naturally, a command, the
 * `wake` verb, the game loop, two ways of being attacked in your bed, and a
 * disconnect — and every one has to put the body back and tear the rooms down. A
 * path that forgets leaves the player stranded in a room whose exits go nowhere
 * real, and leaks zones for the life of the process.
 *
 * So it lives here, it's idempotent, and it's safe to call on someone who was never
 * dreaming. Call it on EVERY wake path, including violent ones.
 */
export function wakeFromDream(player) {
  if (!player?.sleeping?.inDream) return false;
  const home = player.sleeping.bodyZone;
  if (home && isDreamZone(player.current_zone)) {
    removePlayerFromZone(player.id, player.current_zone);
    player.current_zone = home;
    // The body never left, so this is normally a no-op on a Set that already has
    // them. Kept because it costs nothing and makes this correct even if some
    // other path (death respawn sweeps every zone) evicted them mid-dream.
    addPlayerToZone(player.id, home);
  }
  player.sleeping.inDream = false;
  dissolveDreamscape(player.id);
  return true;
}

/**
 * Tear down every room of a player's instance, and stop its beat timer. Called on
 * waking and at the end of a trip.
 */
export function dissolveDreamscape(playerId) {
  let removed = 0;
  for (const [key, inst] of instances) {
    if (inst.playerId !== playerId) continue;
    if (inst.timer) clearInterval(inst.timer);
    instances.delete(key);
  }
  for (const id of [...world.zones.keys()]) {
    if (id.startsWith(`${DREAM_ZONE_PREFIX}${playerId}_`)) { removeTransientZone(id); removed++; }
  }
  return removed;
}

// Test seams. The tether roll is pure over (lines, facts), so regress can hammer
// it a few hundred times and assert the mix without building a single room.
export const _rollTether = rollTether;

// Test seam: how many instances are live. A non-zero count with nobody dreaming is
// a leaked timer.
export const _liveInstanceCount = () => instances.size;
