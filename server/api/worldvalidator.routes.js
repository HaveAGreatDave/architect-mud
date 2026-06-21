import { query } from '../models/db.js';
import { fireHook } from '../engine/plugins.js';

// Tables the orphan-delete endpoint is allowed to touch, and which column
// identifies the owning zone (used in the WHERE clause).
const ORPHAN_TABLES = {
  furniture:       'zone_id',
  npcs:            'zone_id',
  zone_spawns:     'zone_id',
  generators:      'zone_id',
  power_zones:     'id',
  lighting_states: 'zone_id',
  windows:         'zone_interior',
  items:           'zone_id',
};

const DEV_ROLES = ['dev', 'admin', 'builder', 'designer'];

export async function handleWorldValidatorApi(path, method, body, auth) {
  if (!path.startsWith('/worldvalidator')) return null;

  if (!auth || !DEV_ROLES.includes(auth.role)) {
    return { status: 403, body: { error: 'Dev access required' } };
  }

  try {
    if (path === '/worldvalidator/run-full' && method === 'POST') {
      const result = await fireHook('worldValidator.runFull', body || {});
      if (result == null) return { status: 503, body: { error: 'zone-validator plugin not loaded' } };
      return { status: 200, body: result };
    }

    if (path === '/worldvalidator/run-zone' && method === 'POST') {
      const { zoneId, ...opts } = body || {};
      if (!zoneId) return { status: 400, body: { error: 'zoneId required' } };
      const result = await fireHook('worldValidator.runZone', zoneId, opts);
      if (result == null) return { status: 503, body: { error: 'zone-validator plugin not loaded' } };
      return { status: 200, body: result };
    }

    if (path === '/worldvalidator/delete-orphan' && method === 'POST') {
      const { table, refId } = body || {};
      const col = ORPHAN_TABLES[table];
      if (!col || !refId) return { status: 400, body: { error: 'table and refId required' } };
      const { rowCount } = await query(`DELETE FROM ${table} WHERE ${col}=$1`, [refId]);
      return { status: 200, body: { deleted: rowCount } };
    }
  } catch (err) {
    return { status: 500, body: { error: err.message || 'Validation error' } };
  }

  return null;
}
