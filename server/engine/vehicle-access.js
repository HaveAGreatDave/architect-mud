// VEHICLE ACCESS: who may climb into a parked vehicle, and what is standing on each open tile.
//
// One rule for every vehicle (trucks, racers, boats, aircraft): parked on an open world tile, the
// owner can always get in, and anybody else can if it is unlocked. Parking locks it; the owner
// leaves it open with `unlock <vehicle>` standing beside it. A stranger who takes one doesn't come
// to own it: the row keeps its owner, and the taking is `vehicle.taken`, which surveillance charges
// as `vehicle_theft` on its ordinary witness roll. Inside a depot, a hangar or a marina only the
// owner gets in: the counter deals the owner's cards and nobody else's.
//
// A vehicle is locked unless its row says `locked: false`. Rows written before this existed carry
// no key, and they read as locked, which is what parking would have done to them.
//
// THE INDEX is RAM, so the room description can say what is parked here without a query per look.
// Each vehicle plugin seeds it at boot (one query) and keeps it on its own writes: `noteParked` when
// something is left on an open tile, `noteGone` when it leaves one. It is only ever read for prose
// and the lock verbs' "which one"; climbing in always re-reads the row, so a stale entry costs a
// wrong line, never a wrong vehicle.

import { emit } from './events.js';
import { getZone } from './world.js';

export const isLocked = (cd) => cd?.locked !== false;

/** An open world tile: a placed map tile that isn't a building, a room or a crossing. */
export function isOpenTile(zoneId) {
  const z = getZone(zoneId);
  return !!z && z.map_id === 'map_world' && z.grid_x != null && !z.flags?.is_interior;
}

/**
 * May `player` climb into this vehicle where it stands? The owner always may. Anybody else may only
 * on an open tile, and only if it is unlocked. { ok, stranger, why }.
 */
export function boardCheck(player, { ownerId, cd, zoneId }) {
  if (!ownerId || ownerId === player?.id) return { ok: true, stranger: false };
  if (!isOpenTile(zoneId)) return { ok: false, stranger: true, why: 'It isn\'t yours.' };
  if (isLocked(cd)) return { ok: false, stranger: true, why: 'It\'s locked.' };
  return { ok: true, stranger: true };
}

/** A stranger has climbed in and is going: fire the event surveillance charges. */
export function noteTaken(player, { kind, id, ownerId, zoneId, name }) {
  if (!player?.id || !ownerId || ownerId === player.id) return;
  emit('vehicle.taken', { player, kind, id, ownerId, zoneId: zoneId || player.current_zone, name: name || null });
}

// ── The index ────────────────────────────────────────────────────────────────
// zoneId → Map('kind:id' → { kind, id, name, ownerId, locked, cmd })
const byZone = new Map();
const where = new Map();   // 'kind:id' → zoneId

/** `v` is { kind, id, name, ownerId, locked, cmd }; `cmd` is the verb that climbs in. */
export function noteParked(zoneId, v) {
  const key = v.kind + ':' + v.id;
  noteGone(v.kind, v.id);
  if (!isOpenTile(zoneId)) return;
  if (!byZone.has(zoneId)) byZone.set(zoneId, new Map());
  byZone.get(zoneId).set(key, { ...v, locked: v.locked !== false });
  where.set(key, zoneId);
}
export function noteGone(kind, id) {
  const key = kind + ':' + id;
  const z = where.get(key);
  if (!z) return;
  where.delete(key);
  const m = byZone.get(z);
  if (m) { m.delete(key); if (!m.size) byZone.delete(z); }
}
export function noteLock(kind, id, locked) {
  const z = where.get(kind + ':' + id);
  const v = z && byZone.get(z)?.get(kind + ':' + id);
  if (v) v.locked = !!locked;
}
/** Everything parked on this tile, from RAM. */
export function parkedIn(zoneId) { return [...(byZone.get(zoneId)?.values() || [])]; }
export function _resetParked() { byZone.clear(); where.clear(); }

/** The room description's line. Sync, from the index only. */
export function parkedLine(zoneId, player) {
  const list = parkedIn(zoneId);
  if (!list.length) return '';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const items = list.map((v) => {
    const mine = v.ownerId === player?.id;
    const tag = mine ? (v.locked ? 'yours, locked' : 'yours, unlocked') : (v.locked ? 'locked' : 'unlocked');
    const link = (mine || !v.locked) && v.cmd
      ? `<span class="action-link" data-action="cmd" data-cmd="${esc(v.cmd)}" title="climb in">${esc(v.name)}</span>`
      : `<span class="text-dim">${esc(v.name)}</span>`;
    return `${link} <span class="text-dim">(${tag})</span>`;
  });
  return `<span class="furniture-label">Parked here:</span> ${items.join(', ')}`;
}

// ── lock / unlock from outside ───────────────────────────────────────────────
// Each vehicle plugin registers how to set its latch. The verbs (trucking's lock/unlock router)
// find the player's own vehicle on this tile through the index and call it.
const lockers = new Map();
/** `setLocked(id, ownerId, locked)` writes the row; resolves true when it did. */
export function registerVehicleLock(kind, setLocked) { lockers.set(kind, setLocked); }

/** What the player owns parked where they stand, matching `word` (a name, an id, a kind). */
export function ownParkedHere(player, word = '') {
  const w = String(word || '').trim().toLowerCase();
  const mine = parkedIn(player?.current_zone).filter((v) => v.ownerId === player?.id && lockers.has(v.kind));
  if (!w) return mine;
  return mine.filter((v) => v.id.toLowerCase() === w || v.kind === w || v.name.toLowerCase().includes(w)
    || (v.words || []).includes(w));
}

/**
 * `lock`/`unlock` on a vehicle of yours parked here. Undefined when nothing of yours matches, so the
 * caller falls through to doors.
 */
export async function setParkedLock(player, want, word) {
  const list = ownParkedHere(player, word);
  if (!list.length) return undefined;
  if (list.length > 1 && word) return { type: 'output', message: `Which one? ${list.map((v) => `<b>${v.name}</b> (${want ? 'lock' : 'unlock'} ${v.id})`).join(', ')}` };
  const v = list[0];
  if (v.locked === want) return { type: 'output', message: `<span class="text-dim">The ${v.name} is already ${want ? 'locked' : 'unlocked'}.</span>` };
  const ok = await lockers.get(v.kind)(v.id, player.id, want);
  if (!ok) return { type: 'output', message: '<span class="text-dim">It won\'t take the key.</span>' };
  noteLock(v.kind, v.id, want);
  return { type: 'output', message: want
    ? `<span class="text-dim">You lock the ${v.name}. Nobody else gets into it now.</span>`
    : `<span class="text-dim">You leave the ${v.name} unlocked. Anybody passing can climb in and take it.</span>` };
}
