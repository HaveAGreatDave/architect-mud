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

export async function getFlag(scope, key, player) {
  if (scope === 'world') {
    const m = await worldFlags();
    return m.has(key) ? m.get(key) : undefined;
  }
  if (!player) return undefined;
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
    await query(
      `INSERT INTO player_flags (player_id, flag_key, flag_value, updated_at)
       VALUES ($1, $2, $3, EXTRACT(EPOCH FROM NOW()))
       ON CONFLICT (player_id, flag_key) DO UPDATE SET flag_value=$3, updated_at=EXTRACT(EPOCH FROM NOW())`,
      [player.id, key, v]
    );
  }
}

export async function clearFlag(scope, key, player) {
  if (scope === 'world') {
    await query('DELETE FROM world_flags WHERE flag_key=$1', [key]);
    (await worldFlags()).delete(key);
  } else if (player) {
    await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [player.id, key]);
  }
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

export async function evalCondition(condition, player) {
  if (!condition) return true;
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

export async function evalConditions(conditions, player) {
  if (!conditions) return true;
  const list = Array.isArray(conditions) ? conditions : [conditions];
  if (list.length === 1) return evalCondition(list[0], player);
  // Conditions are independent single-row reads — issue them together rather
  // than serially chaining a round trip per condition (AND semantics unchanged;
  // this just gives up the early-exit, which cost more in latency than it saved).
  const results = await Promise.all(list.map((c) => evalCondition(c, player)));
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
