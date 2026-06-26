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

export async function getFlag(scope, key, player) {
  if (scope === 'world') {
    const { rows } = await query('SELECT flag_value FROM world_flags WHERE flag_key=$1', [key]);
    return rows.length ? rows[0].flag_value : undefined;
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
  } else if (player) {
    await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [player.id, key]);
  }
}

// --- Conditions ------------------------------------------------------------
//
// A Condition is { flag, scope?:'player'|'world', op?, value? }.
// ops: set (default, flag exists) | unset | eq | neq | gt | lt.
// evalConditions ANDs a list (or a single condition); empty/missing => true.

export async function evalCondition(condition, player) {
  if (!condition || !condition.flag) return true;
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
  for (const c of list) {
    if (!(await evalCondition(c, player))) return false;
  }
  return true;
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
