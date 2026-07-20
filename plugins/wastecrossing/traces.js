// Void ghost-traces — the dead are your map.
//
// Scrawled 4-letter notes and corpses left by prior crossers, keyed by
// (voidKey, window, room_salt) so they are SHARED across every private instance
// this window — async presence, no live collision (the Dark Souls bloodstain
// model). The room_salt is the deterministic part of a room's identity (`t2`,
// `reach1`, `d_t2`), carried on `flags.void_salt`, so a trace pins to the same
// room in everyone's instance.
//
// A corpse can carry a `pack` (the dead's item ids) and a `claimed` flag — the
// first crosser to sift it takes it, globally (async scarcity = the claim ledger).
//
// Near-zero DB: one INSERT per scrawl/death (rare events, never a hot path), reads
// served from a per-(void, window) RAM cache, stale windows purged as they rotate.
import { query } from '../../server/models/db.js';

const cache = new Map();  // `${voidKey}|${window}` -> Map<salt, trace[]>
const loaded = new Set(); // which (void, window) keys have been loaded from the DB

function ck(voidKey, window) { return `${voidKey}|${window}`; }

// Warm the cache for a (void, window) with one query. Idempotent.
export async function loadWindow(voidKey, window) {
  const k = ck(voidKey, window);
  if (loaded.has(k)) return;
  loaded.add(k); // mark first so concurrent launches don't double-load
  const salts = new Map();
  cache.set(k, salts);
  try {
    const { rows } = await query(
      'SELECT id, room_salt, kind, handle, note, pack, claimed, created_at FROM void_traces WHERE void_key=$1 AND window_id=$2 ORDER BY id',
      [voidKey, window]
    );
    for (const r of rows) {
      if (!salts.has(r.room_salt)) salts.set(r.room_salt, []);
      salts.get(r.room_salt).push(r);
    }
    query('DELETE FROM void_traces WHERE window_id < $1', [window - 1]).catch(() => {}); // purge as windows rotate
  } catch (e) { console.error('[wastecrossing/traces] loadWindow:', e.message); }
}

// All traces at a room this window (served from RAM; 0 DB round trips).
export function getTraces(voidKey, window, salt) {
  return cache.get(ck(voidKey, window))?.get(salt) || [];
}

// Leave a trace: cache immediately (RAM is authoritative for the session) + persist.
export async function addTrace(voidKey, window, salt, kind, handle, note, pack = null) {
  const trace = { id: null, room_salt: salt, kind, handle: handle || null, note: note || null, pack, claimed: false, created_at: 0 };
  const k = ck(voidKey, window);
  if (!cache.has(k)) { cache.set(k, new Map()); loaded.add(k); }
  const salts = cache.get(k);
  if (!salts.has(salt)) salts.set(salt, []);
  salts.get(salt).push(trace);
  try {
    const { rows } = await query(
      'INSERT INTO void_traces (void_key, window_id, room_salt, kind, handle, note, pack, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,EXTRACT(EPOCH FROM NOW())) RETURNING id',
      [voidKey, window, salt, kind, trace.handle, trace.note, pack ? JSON.stringify(pack) : null]
    );
    trace.id = rows?.[0]?.id ?? null; // so it can be claimed later
  } catch (e) { console.error('[wastecrossing/traces] addTrace:', e.message); }
  return trace;
}

// Mark a corpse-pack / big-score claimed — first come, globally (RAM + DB).
export async function claimTrace(trace) {
  trace.claimed = true;
  if (trace.id == null) return;
  await query('UPDATE void_traces SET claimed=TRUE WHERE id=$1', [trace.id]).catch(() => {});
}

export const _test = { cache, loaded, loadWindow, getTraces, addTrace, claimTrace };
