/**
 * Flag store + Conditions (Phase 4).
 *
 * A Flag is persisted key/value state — player-scoped or world-scoped — read by
 * Conditions in Dialogue, Scripts, and Quests (CONTEXT.md). This is unrelated to
 * the legacy `flags` JSONB tag bag, which folds into the Tag system (ADR-0003).
 *
 * Registers the SET_FLAG / CLEAR_FLAG Actions so Flags are mutated through the
 * canonical Action path like everything else (ADR-0001).
 */
import { query } from '../models/db.js';
import { registerAction } from './actions.js';

// --- Store -----------------------------------------------------------------

// world_flags is tiny, global, and mutated only through setFlag/clearFlag below,
// so reads are served from a write-through map after one load — world-scoped
// Conditions (dialogue gates, scripts) stop costing a round trip each.
let _worldFlags = null;
async function worldFlags() {
  if (_worldFlags) return _worldFlags;
  const { rows } = await query('SELECT flag_key, flag_value FROM world_flags');
  _worldFlags = new Map(rows.map(r => [r.flag_key, r.flag_value]));
  return _worldFlags;
}

// --- Player flag cache ------------------------------------------------------
//
// player_flags is the mandated home for per-player scalar state (CLAUDE.md: no
// new sparse columns on `players`), so it grows by design — and every read used
// to be a remote round trip. It's now hydrated once at login into `player._flags`
// (a Map), mirroring the relations substrate.
//
// THE CONTRACT — read this before adding a writer:
//   Every INSERT/UPDATE/DELETE against player_flags goes through this module.
//   Nothing else may write the table. A raw UPDATE elsewhere leaves a live
//   player's Map stale and the game reads a value that is no longer true.
//   The funnel is deliberately wide enough that you never need to reach past it:
//     one key      → getFlag / setFlag / clearFlag
//     several keys → getFlagsIn / setFlags / clearFlagsIn
//     a prefix     → getFlagsByPrefix / clearFlagsByPrefix
//   Writers holding only an id (no live player object) use the *ById variants.
//
// Reads fall back to a query when the player isn't hydrated — an offline player,
// or a synthetic player object (tests, dev tools). So a non-hydrated caller is
// slower but never wrong, which is what makes this safe to adopt incrementally.

// playerId -> live player object, for id-only writers that must invalidate a
// hydrated Map they have no reference to.
const _hydrated = new Map();

// ONE query, at login. Called from finishAuth alongside hydrateRelations.
// Mutates the live player in place — never clone-and-replace; the game loop
// holds direct references.
export async function hydratePlayerFlags(player) {
  if (!player?.id) return;
  player._flags = new Map();
  try {
    const { rows } = await query(
      'SELECT flag_key, flag_value FROM player_flags WHERE player_id = $1',
      [player.id]
    );
    for (const r of rows) player._flags.set(r.flag_key, r.flag_value);
  } catch (err) {
    // A player whose flags won't load is a player who reads as having none —
    // degraded, never broken. Never block a login on this. Drop the Map so
    // reads fall back to querying rather than trusting an empty cache.
    console.error(`[flags] hydrate failed for ${player.id}: ${err.message}`);
    delete player._flags;
    return;
  }
  _hydrated.set(player.id, player);
}

// Drop a player's cache on logout so the registry doesn't pin dead objects.
export function evictPlayerFlags(player) {
  const id = typeof player === 'string' ? player : player?.id;
  if (!id) return;
  const p = _hydrated.get(id);
  if (p) delete p._flags;
  _hydrated.delete(id);
}

const cacheOf = player => (player?._flags instanceof Map ? player._flags : null);
// Resolve the cache for an id-only writer: the caller's own object if hydrated,
// otherwise the registry (the player may be live under a different reference).
const cacheById = id => cacheOf(_hydrated.get(id));

export async function getFlag(scope, key, player) {
  if (scope === 'world') {
    const m = await worldFlags();
    return m.has(key) ? m.get(key) : undefined;
  }
  if (!player) return undefined;
  const cache = cacheOf(player);
  if (cache) return cache.has(key) ? cache.get(key) : undefined;
  const { rows } = await query(
    'SELECT flag_value FROM player_flags WHERE player_id=$1 AND flag_key=$2',
    [player.id, key]
  );
  return rows.length ? rows[0].flag_value : undefined;
}

export async function setFlag(scope, key, value, player) {
  const v = value == null ? 'true' : String(value);
  if (scope === 'world') {
    await query(
      `INSERT INTO world_flags (flag_key, flag_value, updated_at)
       VALUES ($1, $2, EXTRACT(EPOCH FROM NOW()))
       ON CONFLICT (flag_key) DO UPDATE SET flag_value=$2, updated_at=EXTRACT(EPOCH FROM NOW())`,
      [key, v]
    );
    (await worldFlags()).set(key, v);
  } else {
    // Deliberately loud, matching the pre-cache behaviour: a player-scoped
    // SET_FLAG with no actor used to fail on the INSERT. Silently no-oping here
    // would let a quest flag "save" without saving — the player is then stuck
    // with nothing to show why. clearFlag's `if (player)` guard is quiet by
    // contrast, but that is its original behaviour and callers rely on it.
    if (!player?.id) throw new Error(`setFlag('player', '${key}') requires a player with an id.`);
    await setFlagById(player.id, key, v);
    cacheOf(player)?.set(key, v);
  }
}

export async function clearFlag(scope, key, player) {
  if (scope === 'world') {
    await query('DELETE FROM world_flags WHERE flag_key=$1', [key]);
    (await worldFlags()).delete(key);
  } else if (player) {
    await clearFlagsIn(player.id, [key]);
  }
}

// --- Funnel: id-based + multi-key variants ---------------------------------
//
// These exist so callers that used to reach past setFlag/clearFlag with raw SQL
// (a batched INSERT, a prefix DELETE, a `= ANY($2)` read) have a first-class way
// to do it that keeps the cache honest.

// Write one flag for a player who may be offline / referenced only by id.
export async function setFlagById(playerId, key, value) {
  if (!playerId) return;
  const v = value == null ? 'true' : String(value);

  // NOT coalesced against the cache, deliberately. Skipping the write when the
  // cached value already matches looks free — nothing reads
  // player_flags.updated_at, and every production writer funnels through this
  // file — but it promotes the flag cache from a read optimisation to a WRITE
  // authority: the row only stays correct as long as nothing ever changes
  // player_flags behind the cache's back. Today only test files do that, and the
  // suite caught it immediately (a raw DELETE followed by a same-value setFlag
  // left the row missing). The failure mode is silent and permanent, and the
  // measured saving was a handful of writes a minute. Not worth the trade.
  await query(
    `INSERT INTO player_flags (player_id, flag_key, flag_value, updated_at)
     VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (player_id, flag_key) DO UPDATE SET flag_value=$3, updated_at=EXTRACT(EPOCH FROM NOW())`,
    [playerId, key, v]
  );
  cacheById(playerId)?.set(key, v);
}

// UPDATE-only: change a flag if the player already has it, do nothing if they
// don't. Distinct from setFlagById, which upserts — some callers deliberately
// don't want to mint a row for a player who never had the flag (clearing a
// wanted level on someone who was never wanted shouldn't create `wanted=0`).
export async function updateFlagById(playerId, key, value) {
  if (!playerId) return;
  const v = value == null ? 'true' : String(value);
  const { rowCount } = await query(
    `UPDATE player_flags SET flag_value=$3, updated_at=EXTRACT(EPOCH FROM NOW())
      WHERE player_id=$1 AND flag_key=$2`,
    [playerId, key, v]
  );
  if (rowCount) cacheById(playerId)?.set(key, v);
}

// Write several flags in ONE round trip. `entries` is [[key, value], ...] or a
// plain object. Replaces the hand-rolled batched INSERTs.
export async function setFlags(playerOrId, entries) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  const pairs = Array.isArray(entries) ? entries : Object.entries(entries || {});
  if (!playerId || !pairs.length) return;
  const norm = pairs.map(([k, v]) => [k, v == null ? 'true' : String(v)]);
  const vals = norm.map((_, i) => `($1, $${i * 2 + 2}::text, $${i * 2 + 3}::text, EXTRACT(EPOCH FROM NOW()))`).join(',');
  await query(
    `INSERT INTO player_flags (player_id, flag_key, flag_value, updated_at)
     VALUES ${vals}
     ON CONFLICT (player_id, flag_key) DO UPDATE SET flag_value=EXCLUDED.flag_value, updated_at=EXCLUDED.updated_at`,
    [playerId, ...norm.flat()]
  );
  const cache = typeof playerOrId === 'string' ? cacheById(playerId) : (cacheOf(playerOrId) || cacheById(playerId));
  if (cache) for (const [k, v] of norm) cache.set(k, v);
}

// Clear several keys in ONE round trip.
export async function clearFlagsIn(playerOrId, keys) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  if (!playerId || !keys?.length) return;
  await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key = ANY($2)', [playerId, keys]);
  const cache = typeof playerOrId === 'string' ? cacheById(playerId) : (cacheOf(playerOrId) || cacheById(playerId));
  if (cache) for (const k of keys) cache.delete(k);
}

// Clear every key starting with `prefix` (the LIKE 'foo%' deletes).
// Returns how many rows were removed — callers narrate the count.
export async function clearFlagsByPrefix(playerOrId, prefix) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  if (!playerId || !prefix) return 0;
  const { rowCount } = await query(
    "DELETE FROM player_flags WHERE player_id=$1 AND flag_key LIKE $2",
    [playerId, `${prefix.replace(/([%_\\])/g, '\\$1')}%`]
  );
  const cache = typeof playerOrId === 'string' ? cacheById(playerId) : (cacheOf(playerOrId) || cacheById(playerId));
  if (cache) for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
  return rowCount;
}

// Single read for a caller holding only an id (offline player, or a subsystem
// that keys on playerId throughout).
export async function getFlagById(playerId, key) {
  if (!playerId) return undefined;
  const cache = cacheById(playerId);
  if (cache) return cache.has(key) ? cache.get(key) : undefined;
  const { rows } = await query(
    'SELECT flag_value FROM player_flags WHERE player_id=$1 AND flag_key=$2',
    [playerId, key]
  );
  return rows.length ? rows[0].flag_value : undefined;
}

// Insert only if the player doesn't already have the key. Returns true if a row
// was actually created. This is the "learn it once, don't overwrite what's
// already recorded" shape — distinct from setFlagById, which clobbers.
export async function insertFlagIfAbsentById(playerId, key, value) {
  if (!playerId) return false;
  const v = value == null ? 'true' : String(value);
  const { rows } = await query(
    `INSERT INTO player_flags (player_id, flag_key, flag_value, updated_at)
     VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW()))
     ON CONFLICT (player_id, flag_key) DO NOTHING
     RETURNING flag_value`,
    [playerId, key, v]
  );
  if (rows.length) cacheById(playerId)?.set(key, v);
  return rows.length > 0;
}

// Read several prefixes and/or exact keys in ONE round trip → Map(key → value).
// Exists so a caller with a compound read (a cookbook: two prefixes plus a
// timestamp key) doesn't have to choose between the funnel and its round-trip
// budget. A hydrated player answers entirely from RAM.
export async function getFlagsMulti(playerOrId, { prefixes = [], keys = [] } = {}) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  const out = new Map();
  if (!playerId || (!prefixes.length && !keys.length)) return out;
  const cache = typeof playerOrId === 'string' ? cacheById(playerId) : (cacheOf(playerOrId) || cacheById(playerId));
  if (cache) {
    for (const [k, v] of cache) {
      if (keys.includes(k) || prefixes.some(p => k.startsWith(p))) out.set(k, v);
    }
    return out;
  }
  const esc = p => p.replace(/([%_\\])/g, '\\$1');
  const clauses = [];
  const params = [playerId];
  for (const p of prefixes) { params.push(`${esc(p)}%`); clauses.push(`flag_key LIKE $${params.length}`); }
  if (keys.length) { params.push(keys); clauses.push(`flag_key = ANY($${params.length})`); }
  const { rows } = await query(
    `SELECT flag_key, flag_value FROM player_flags WHERE player_id=$1 AND (${clauses.join(' OR ')})`,
    params
  );
  for (const r of rows) out.set(r.flag_key, r.flag_value);
  return out;
}

// Read a named set of keys → Map(key → value). Served from cache when hydrated.
export async function getFlagsIn(playerOrId, keys) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  const out = new Map();
  if (!playerId || !keys?.length) return out;
  const cache = typeof playerOrId === 'string' ? cacheById(playerId) : (cacheOf(playerOrId) || cacheById(playerId));
  if (cache) {
    for (const k of keys) if (cache.has(k)) out.set(k, cache.get(k));
    return out;
  }
  const { rows } = await query(
    'SELECT flag_key, flag_value FROM player_flags WHERE player_id=$1 AND flag_key = ANY($2)',
    [playerId, keys]
  );
  for (const r of rows) out.set(r.flag_key, r.flag_value);
  return out;
}

// Read every key starting with `prefix` → Map(key → value). Replaces the
// LIKE-prefix SELECTs. A hydrated player answers this with zero round trips.
export async function getFlagsByPrefix(playerOrId, prefix) {
  const playerId = typeof playerOrId === 'string' ? playerOrId : playerOrId?.id;
  const out = new Map();
  if (!playerId || !prefix) return out;
  const cache = typeof playerOrId === 'string' ? cacheById(playerId) : (cacheOf(playerOrId) || cacheById(playerId));
  if (cache) {
    for (const [k, v] of cache) if (k.startsWith(prefix)) out.set(k, v);
    return out;
  }
  const { rows } = await query(
    "SELECT flag_key, flag_value FROM player_flags WHERE player_id=$1 AND flag_key LIKE $2",
    [playerId, `${prefix.replace(/([%_\\])/g, '\\$1')}%`]
  );
  for (const r of rows) out.set(r.flag_key, r.flag_value);
  return out;
}

// --- Conditions ------------------------------------------------------------
//
// Three condition shapes, distinguished by which key is present:
//   { flag, scope?:'player'|'world', op?, value? }  — persisted flag state
//   { item: 'item_x', op?:'has'|'lacks', quantity? } — carried inventory
//   { stat: 'brawn', op?:'gte', value: 5 }           — a player stat column
// flag ops: set (default) | unset | eq | neq | gt | lt.
// stat ops: gte (default) | gt | lt | lte | eq | neq.
// evalConditions ANDs a list (or a single condition); empty/missing => true.
//
// Item/stat conditions each cost ONE indexed single-row read. They're for
// dialogue gates and script branches (cold paths) — never put one in a
// per-move/per-swing path.

// The stat columns are stat_<name> (docs/architecture.md); the allow-list keeps
// a condition from interpolating arbitrary SQL into the column position.
const STAT_COLUMNS = new Set(['brawn', 'reflexes', 'endurance', 'brains', 'cool', 'senses']);

async function evalItemCondition(condition, player) {
  if (!player) return false;
  const want = Math.max(1, Number(condition.quantity) || 1);
  // Equipped counts as carried; containers do too — "do you have one on you".
  const { rows } = await query(
    `SELECT COALESCE(SUM(quantity), 0) AS n FROM player_inventory
     WHERE player_id = $1 AND item_id = $2`,
    [player.id, condition.item]
  );
  const have = Number(rows[0]?.n) || 0;
  return (condition.op === 'lacks') ? have < want : have >= want;
}

async function evalStatCondition(condition, player) {
  if (!player) return false;
  const name = String(condition.stat || '').toLowerCase();
  if (!STAT_COLUMNS.has(name)) {
    console.warn(`[flags] unknown stat condition: ${condition.stat}`);
    return false;
  }
  // Live player objects carry the stat columns already — no round trip when the
  // condition is evaluated against a connected player, which is the normal case.
  let current = player[`stat_${name}`];
  if (current == null) {
    const { rows } = await query(`SELECT stat_${name} AS v FROM players WHERE id = $1`, [player.id]);
    current = rows[0]?.v;
  }
  const a = Number(current) || 0;
  const b = Number(condition.value) || 0;
  switch (condition.op || 'gte') {
    case 'gt':  return a > b;
    case 'lt':  return a < b;
    case 'lte': return a <= b;
    case 'eq':  return a === b;
    case 'neq': return a !== b;
    default:    return a >= b; // gte
  }
}

// ── Condition-shape registry ─────────────────────────────────────────────────
//
// The three shapes above are built in because they're universal (persisted
// state, inventory, stats). A substrate that wants its own gate registers the
// key it owns here instead of being imported into this file — which is what
// keeps flags.js free of an import cycle with the substrates that depend on it
// (relations.js imports actions.js; actions.js reaches flags.js).
//
// A registered evaluator may be sync or async; `evalCondition` awaits either.
const conditionShapes = new Map();
export function registerConditionShape(key, fn) {
  if (!key || typeof fn !== 'function') throw new Error('registerConditionShape: key and fn required');
  conditionShapes.set(key, fn);
}
export function getRegisteredConditionShapes() { return [...conditionShapes.keys()]; }

export async function evalCondition(condition, player, context) {
  if (!condition) return true;
  for (const [key, fn] of conditionShapes) {
    if (condition[key] === undefined) continue;
    try {
      return await fn(condition, player, context);
    } catch (err) {
      // A gate that throws must not take the whole dialogue down with it. Fail
      // CLOSED (hide the option) — the same direction an unknown stat fails.
      console.warn(`[flags] condition shape ${key} threw: ${err.message}`);
      return false;
    }
  }
  if (condition.item) return evalItemCondition(condition, player);
  if (condition.stat) return evalStatCondition(condition, player);
  if (!condition.flag) return true;
  const scope = condition.scope || 'player';
  const current = await getFlag(scope, condition.flag, player);
  switch (condition.op || 'set') {
    case 'set':   return current !== undefined;
    case 'unset': return current === undefined;
    case 'eq':    return String(current) === String(condition.value);
    case 'neq':   return String(current) !== String(condition.value);
    case 'gt':    return Number(current) > Number(condition.value);
    case 'lt':    return Number(current) < Number(condition.value);
    default:      return true;
  }
}

export async function evalConditions(conditions, player, context) {
  if (!conditions) return true;
  const list = Array.isArray(conditions) ? conditions : [conditions];
  if (list.length === 1) return evalCondition(list[0], player, context);
  // Conditions are independent single-row reads — issue them together rather
  // than serially chaining a round trip per condition (AND semantics unchanged;
  // this just gives up the early-exit, which cost more in latency than it saved).
  const results = await Promise.all(list.map((c) => evalCondition(c, player, context)));
  return results.every(Boolean);
}

// --- Actions ---------------------------------------------------------------

registerAction({
  type: 'SET_FLAG',
  handler: async ({ actor, params, emit }) => {
    const { scope = 'player', flag, value } = params;
    if (!flag) return { type: 'error', message: 'SET_FLAG requires a flag key.' };
    await setFlag(scope, flag, value, actor);
    emit('flag.set', { actor, scope, flag, value: value == null ? 'true' : String(value) });
    return { type: 'flag', flag, scope };
  },
});

registerAction({
  type: 'CLEAR_FLAG',
  handler: async ({ actor, params, emit }) => {
    const { scope = 'player', flag } = params;
    if (!flag) return { type: 'error', message: 'CLEAR_FLAG requires a flag key.' };
    await clearFlag(scope, flag, actor);
    emit('flag.cleared', { actor, scope, flag });
    return { type: 'flag', flag, scope };
  },
});
