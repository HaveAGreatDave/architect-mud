import { query } from '../models/db.js';

const registry = new Map();

export function registerLockAuth(type, fn) {
  registry.set(type, fn);
}

export async function resolveLockAuth(lockTag, door, player) {
  const fn = registry.get(lockTag.type);
  return fn ? fn(lockTag, door, player) : false;
}

registerLockAuth('lock:hololock', async (lockTag, door, player) => {
  const { rows } = await query(
    'SELECT 1 FROM apartments WHERE zone_id=$1 AND owner_id=$2',
    [door.zone_id, player.id]
  );
  return rows.length > 0;
});

registerLockAuth('lock:keycardlock', async (lockTag, door, player) => {
  if (!lockTag.keyItemId) return false;
  const { rows } = await query(
    'SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id=$2 LIMIT 1',
    [player.id, lockTag.keyItemId]
  );
  return rows.length > 0;
});
