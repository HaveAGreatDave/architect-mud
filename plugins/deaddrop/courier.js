// ── The courier (proposal §9) ────────────────────────────────────────────────
//
// **A cache is never conjured.** An authored drop does not spring into existence
// when a dialogue node fires; an NPC walks it there and puts it in. That single
// decision is what the rest of this file falls out of, and it is worth the extra
// machinery because it turns the feature from a quest flag into a thing that
// happens in the world, at a time, in front of whoever is standing there.
//
// Until the courier arrives there is nothing to find — so a player who was told
// early can get there first and watch it happen.
//
// ⚠ THE ONE WHO TELLS YOU AND THE ONE WHO STASHES ARE NEVER THE SAME NPC, and it
// is enforced here rather than left to authoring: booking excludes the advisor
// from the candidate set. It reads as tradecraft, and it is — the advisor knows
// WHERE, the courier knows WHAT, and neither knows both. The mechanical reason is
// that it stops one NPC being the entire chain: kill, rob or interrogate the
// advisor and you still have to find the courier, and whoever watched the stash
// has no idea who commissioned it.
//
// ⚠ IT WAITS FOR PRIVACY, AND STASHES ANYWAY WHEN ITS PATIENCE RUNS OUT. This is
// deliberately not a deadlock design. If a loiterer could deny a drop then
// standing in a room would be a hard counter to the whole system, discoverable in
// one evening and unbeatable after — and worse, every drop you did not see would
// be one that provably had not happened yet, which turns a system built on
// ambiguity into a reliable sensor. These are hired hands doing this for the
// fourth time this week, in a city where nobody looks up. The job is covert, not
// impossible.
//
// The room is not lied to when that happens: the stash still emits its line.
// **Covert is not invisible.** The act is performed in front of you, described
// accurately, and reads as nothing. Missing it is a failure of attention rather
// than something the game hid — and that only works because the line is drawn
// from the same `handling` pool fourteen non-couriers draw from every day.

import { randomUUID } from 'crypto';
import { world, getZone, getZonePlayers, insertFurniture, getZoneFurniture } from '../../server/engine/world.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { eligibleNpcs } from '../../server/engine/npc-banter.js';
import { emit } from '../../server/engine/events.js';

// How long a courier will hold off for an empty room before doing it anyway.
const PATIENCE_MS = 4 * 60 * 1000;
// A booking that cannot reach its destination at all is abandoned rather than
// retried forever — an unreachable drop is a mis-authored one, and a courier
// walking into a wall until the heat death of the server is not a better outcome.
const GIVE_UP_MS = 30 * 60 * 1000;
const DEFAULT_CAPACITY = 4000;

const bookings = new Map();   // id -> booking. RAM only, deliberately: see below.

// ⚠ RAM ONLY, AND THAT IS THE SAME RULE THE INCIDENTS FOLLOW. A booking holds a
// live NPC and a half-walked route; neither survives a restart in any meaningful
// state, and a persisted "somebody is on their way" that outlives the walk is a
// promise the world cannot keep. A restart means the drop was never made, which
// is a state the fiction already has a word for.
export function liveBookings() { return [...bookings.values()]; }

const rollCode = () => String(Math.floor(1000 + Math.random() * 9000));

/**
 * Commission a drop. Returns the booking (with its `code`) or null.
 *
 * `advisorId` is excluded from the candidates — see the ⚠ above. `forPlayerId` is
 * who the drop is for; their presence does NOT count as being watched, because
 * the whole point is that they may be standing there waiting for it.
 */
export function bookCourier({ zoneId, advisorId = null, forPlayerId = null, capacity = DEFAULT_CAPACITY, name = 'a taped bundle', lock = true } = {}) {
  if (!zoneId || !getZone(zoneId)) return null;
  // One booking per room at a time. Two couriers converging on one doorway is a
  // farce, and `place.js` already refuses a second cache in a room anyway — so a
  // second booking could only ever end in a courier arriving with nowhere to put
  // it, which is a walk with no ending.
  if ([...bookings.values()].some((b) => b.zoneId === zoneId)) return null;
  if (getZoneFurniture(zoneId).some((f) => f.flags?.dead_drop)) return null;

  const candidate = pickCourier(zoneId, advisorId);
  if (!candidate) return null;

  const booking = {
    id: `dd_${randomUUID()}`,
    npcId: candidate.id,
    npcName: candidate.name,
    zoneId,
    forPlayerId,
    capacity,
    name,
    code: lock ? rollCode() : null,
    bookedAt: Date.now(),
    waitingSince: null,
  };
  bookings.set(booking.id, booking);
  emit('deaddrop.courier.booked', { npcId: candidate.id, zoneId });
  return booking;
}

// Who can carry it. `eligibleNpcs` is the ONE predicate that already answers "is
// this NPC free to be described doing something ordinary" — asleep, on shift, in
// combat or mid-trade all disqualify — so a courier is never an NPC the world has
// other plans for, for exactly the reasons they never banter.
//
// Candidates come from ANYWHERE, not just the destination: a courier who has to
// walk is the whole point, and requiring one to be standing in the room already
// would make a drop into a teleport with a delay.
function pickCourier(zoneId, advisorId) {
  const seen = new Set();
  const usable = [];
  for (const npc of world.npcs.values()) {
    if (!npc || npc.id === advisorId || seen.has(npc.id)) continue;
    seen.add(npc.id);
    if (!npc.zone_id) continue;
    if (!eligibleNpcs(npc.zone_id).some((n) => n.id === npc.id)) continue;
    // ⚠ It has to be able to GET there. An unreachable destination is a courier
    // who walks into a wall until GIVE_UP_MS, which is a silent non-delivery.
    const path = npc.zone_id === zoneId ? [zoneId] : findPath(npc.zone_id, zoneId, npc);
    if (!path || (path.length < 1)) continue;
    usable.push({ npc, hops: Math.max(0, path.length - 1) });
  }
  if (!usable.length) return null;
  // Nearest half, then random within it: close enough that the drop happens on a
  // human timescale, random enough that it is not always the same face.
  usable.sort((a, b) => a.hops - b.hops);
  const shortlist = usable.slice(0, Math.max(1, Math.ceil(usable.length / 2)));
  return shortlist[Math.floor(Math.random() * shortlist.length)].npc;
}

/**
 * Is the room clear enough to do this?
 *
 * ⚠ The player the drop is FOR does not count as a witness. They may well be
 * standing there waiting, and a courier that refused to work in front of the
 * recipient would deadlock every drop a player was told about early — which is
 * precisely the case the design wants to be watchable.
 */
export function roomIsClear(zoneId, forPlayerId) {
  const players = getZonePlayers(zoneId) || [];
  return !players.some((p) => p && p.id !== forPlayerId);
}

/**
 * One step of every live booking. Driven from the plugin's tick; nothing here is
 * on a hot path and every read is RAM.
 */
export async function courierTick({ isWitnessed = null, emitLine = null } = {}) {
  const now = Date.now();
  for (const b of [...bookings.values()]) {
    // Read the LIVE npc off the world index, not off a copy taken at booking —
    // it has been walking, and a stale `zone_id` would path it from where it used
    // to be.
    const npc = world.npcs.get(b.npcId);
    if (!npc || !npc.zone_id) { bookings.delete(b.id); continue; }   // died, despawned, went home

    if (now - b.bookedAt > GIVE_UP_MS) { bookings.delete(b.id); continue; }

    // ── Walking ──────────────────────────────────────────────────────────────
    // One hop per tick through `moveEntity`, which ai-behaviour calls the single
    // writer for every mob tile change — so the room sees them arrive and leave
    // exactly as it would for any other NPC, and `zone.npcs` cannot drift.
    if (npc.zone_id !== b.zoneId) {
      const path = findPath(npc.zone_id, b.zoneId, npc);
      if (!path || path.length < 2) continue;              // hold and retry; GIVE_UP_MS bounds it
      moveEntity(npc, path[1], null, null, {});
      continue;
    }

    // ── Arrived: wait for the coast, but not forever ─────────────────────────
    if (b.waitingSince == null) b.waitingSince = now;
    const clear = roomIsClear(b.zoneId, b.forPlayerId)
      && !(isWitnessed ? await isWitnessed(b.zoneId).catch(() => false) : false);
    const outOfPatience = now - b.waitingSince >= PATIENCE_MS;
    if (!clear && !outOfPatience) continue;

    await stash(b, npc, emitLine);
    bookings.delete(b.id);
  }
}

async function stash(b, npc, emitLine) {
  const id = `ddrop_${randomUUID()}`;
  await insertFurniture({
    id,
    zone_id: b.zoneId,
    name: b.name,
    description: "Nothing about the room suggests it's there.",
    object_type: 'container',
    flags: JSON.stringify({
      container: b.capacity,
      concealed: true,
      dead_drop: true,
      dead_drop_placed: true,
      placed_day: Math.floor(Date.now() / 86400000),
      ...(b.code ? { conceal_code: b.code } : {}),
      aliases: 'stash, drop, bundle',
    }),
    origin: 'player',
    owner_id: null,
  }).catch(() => null);

  // ⚠ THE LINE COMES FROM THE SHARED `handling` POOL AND NAMES THE NPC. It must
  // never name the container, and must never fire on a FAILED stash. A player
  // paying attention gets one real signal and one only: this NPC was here, and
  // later there was a cache here. That has to stay inference, never notification.
  if (emitLine) { try { emitLine(b.zoneId, 'handling', npc.name); } catch { /* a missing line is not a missing stash */ } }
  emit('deaddrop.stashed', { npcId: npc.id, zoneId: b.zoneId, cacheId: id });
}

export function _reset() { bookings.clear(); }
export const _test = { bookings, pickCourier, roomIsClear, PATIENCE_MS, GIVE_UP_MS, rollCode, stash };
