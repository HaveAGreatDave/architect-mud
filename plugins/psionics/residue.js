/**
 * RESIDUE — what a place remembers, and the reason psychometry was built first.
 *
 * ── The rule this file exists to enforce ─────────────────────────────────────
 *
 * PSYCHOMETRY READS THE WORLD'S OWN EXHAUST. IT NEVER INVENTS FICTION.
 *
 * A psychometry that makes things up is a random-text box with a cooldown. It
 * reads well once, and then a player notices the impressions have nothing to do
 * with anything and stops using the verb forever. The version worth building reads
 * events that ACTUALLY HAPPENED to that room, which turns the discipline into an
 * investigation loop no other order can buy, mutate or hack its way into.
 *
 * So this file writes down nothing the game was not already going to do. It
 * subscribes to events that already fire and keeps a small decaying ring buffer
 * per zone. Nothing is persisted, nothing is queried, and no other system has to
 * know it exists.
 *
 * ── The hard rule that keeps it from replacing SPECTER ───────────────────────
 *
 * An impression is FRAGMENTARY, UNATTRIBUTED and UNCORROBORATED. It never yields a
 * name, it never satisfies a `witnessed` check, and it is never evidence.
 *
 * That is not squeamishness about power level — the surveillance plugin already
 * answers "who was in this room" properly, with cameras that can be jammed, owned,
 * and used against their owner. If psychometry answered the same question for
 * free, it would delete a whole shipped system and the counterplay around it.
 *
 * Cameras answer WHO. Psychometry answers WHAT HAPPENED HERE, and then makes you
 * go and find out who. `actorId` is recorded ONLY so a psion can recognise their
 * own work and so signatures can be traced by another psion; it is never rendered
 * into an impression, and `renderResidue` has no access to a name lookup at all.
 *
 * ── Persistence tier ─────────────────────────────────────────────────────────
 *
 * RAM-authoritative, decayed at read, capped per zone. A restart forgets what the
 * walls saw, which is correct: this is a room's short memory, not a record.
 */
import { on } from '../../server/engine/events.js';

// zoneId -> [{ kind, strength, at, actorId }]
const zoneResidue = new Map();

// Twelve entries per room. A ring buffer rather than a log — a room where a lot
// happens should remember the loudest recent things, not everything since boot.
const MAX_PER_ZONE = 12;

/**
 * Half-lives, in ms, by how deep a mark the event leaves.
 *
 * Death is an hour; a spilled drink is four minutes. This table IS the design:
 * it decides what a room can still tell you when you get there late, and it is
 * the only thing standing between "the walls remember a murder" and "the walls
 * remember somebody being mildly annoyed last Tuesday".
 */
const HALFLIFE = {
  death:      3_600_000,
  violence:     900_000,
  fear:         600_000,
  psionic:      600_000,
  crime:        900_000,
  intimacy:     600_000,
  sickness:     300_000,
  filth:        240_000,
};

const DEFAULT_HALFLIFE = 300_000;
const now = () => Date.now();

function decayed(value, at, halfLife) {
  if (!(value > 0)) return 0;
  const elapsed = now() - (at || 0);
  if (elapsed <= 0) return value;
  return value * Math.pow(0.5, elapsed / halfLife);
}

/**
 * Record that something happened in a room.
 *
 * Sync and query-free by contract — this is called from death, combat and crime
 * paths, all of which are hot. It must never become a place anyone awaits.
 */
export function addResidue(zoneId, kind, strength = 1, actorId = null) {
  if (!zoneId || !kind) return;
  const list = zoneResidue.get(zoneId) || [];
  list.push({ kind, strength, at: now(), actorId });
  while (list.length > MAX_PER_ZONE) list.shift();
  zoneResidue.set(zoneId, list);
}

/**
 * What is still readable in this room, strongest first.
 *
 * Faint entries are dropped rather than returned at a strength nobody can use,
 * and the pruned list is written back — which is the only garbage collection this
 * file has, and is why it needs no tick.
 */
export function residueAt(zoneId) {
  const list = zoneResidue.get(zoneId);
  if (!list || !list.length) return [];
  const out = [];
  for (const r of list) {
    const strength = decayed(r.strength, r.at, HALFLIFE[r.kind] || DEFAULT_HALFLIFE);
    if (strength >= 0.12) out.push({ ...r, strength });
  }
  if (out.length !== list.length) {
    if (out.length) zoneResidue.set(zoneId, out);
    else zoneResidue.delete(zoneId);
  }
  return out.sort((a, b) => b.strength - a.strength);
}

export function clearResidue(zoneId) { zoneResidue.delete(zoneId); }

/** Test seam — a non-zero count in a fresh world means something is leaking. */
export function _residueZoneCount() { return zoneResidue.size; }

// ── Subscriptions ────────────────────────────────────────────────────────────
//
// Every one of these events already fires for its own reasons. Psionics is a
// LISTENER here and nothing else — no other system was modified to feed this, and
// if this plugin is disabled the events carry on exactly as before. That is the
// property that makes the whole discipline cheap.
//
// If an event's payload shape changes, the worst case is that a room forgets
// something, never that anything else breaks. Every handler is defensive for that
// reason: this must never be the thing that throws inside somebody else's emit.

export function wireResidue() {
  // { player, killer, cause, deathZone, corpseId, claimed } — gameLoop.js:771.
  // `deathZone` rather than the player's current_zone: by the time this fires the
  // player has already respawned somewhere else, and the room that remembers a
  // death is the one it happened in.
  on('player.death', (p) => {
    try { addResidue(p?.deathZone, 'death', 3, p?.killer?.id || null); }
    catch { /* a room forgetting a death is not worth taking a death path down */ }
  });

  // { actor, npc } / { actor, enemy } — emitted from gameLoop, flight and quests.
  on('npc.killed', (p) => {
    try { addResidue(p?.actor?.current_zone || p?.npc?.current_zone, 'death', 2, p?.actor?.id || null); }
    catch { /* see above */ }
  });
  on('enemy.killed', (p) => {
    try { addResidue(p?.actor?.current_zone, 'violence', 1.2, p?.actor?.id || null); }
    catch { /* see above */ }
  });

  // { being, by } — unconscious.js:73. Somebody went down here and got up again,
  // or did not. Either way the room felt it.
  on('being.knockedOut', (p) => {
    try { addResidue(p?.being?.current_zone, 'violence', 1, p?.by?.id || null); }
    catch { /* see above */ }
  });

  // { player:{id,handle}, key, zoneId, label } — surveillance/index.js:1970.
  // Note we take the id and never the handle: an impression must not carry a name.
  on('crime.witnessed', (p) => {
    try { addResidue(p?.zoneId, 'crime', 1.5, p?.player?.id || null); }
    catch { /* see above */ }
  });

  // { actor, delta, reason } — condition.js:174. Only sharp losses: a slow drift
  // is a mood, not a mark on a room, and recording every tick of it would drown
  // every other kind of residue in the buffer.
  on('sanity.changed', (p) => {
    try {
      const d = Number(p?.delta) || 0;
      if (d <= -5) {
        addResidue(p?.actor?.current_zone, 'fear', Math.min(2, Math.abs(d) / 5), p?.actor?.id || null);
      }
    } catch { /* see above */ }
  });
}
