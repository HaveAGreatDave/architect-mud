// Staging API — change staging and publishing workflow.
//
// All dev-panel writes are intercepted by the client and routed here
// instead of hitting entity endpoints directly. On publish, staged changes
// are applied using the same entity-update functions that the live endpoints
// use (imported from routes.js — circular ESM dep is safe because we only
// call them inside async request handlers, never at module evaluation time).

import { query } from '../models/db.js';
import { removeGenerator, markPowerTopologyDirty } from '../engine/environment.js';
import { reloadMaps } from '../engine/world.js';
import {
  apiCreateZone, apiDeleteZone, apiCreateRegion,
  apiCreateFurniture, apiDeleteFurniture,
  apiCreateNpc, apiDeleteNpc, apiCreateItem, apiDeleteItem, apiCreateEnemy, apiDeleteEnemy,
  apiUpdateZone, apiUpdateEnemy, apiUpdateItem, apiUpdateNpc,
  apiUpdateFurniture, apiUpdateRecipe, apiUpdateMutation, apiUpdateDrug,  apiCreateSpawn, apiDeleteZoneSpawn,
  apiCreateScavengingTable, apiUpdateScavengingTable, apiDeleteScavengingTable,
} from './routes.js';

const DEV_ROLES = ['dev', 'admin', 'builder', 'designer'];

export async function handleStagingApi(path, method, body, auth) {
  if (!path.startsWith('/staging')) return null;
  // Defense-in-depth behind the CONTENT_READONLY gate in handleApiRequest: even
  // if a future dispatch path reaches staging directly, prod content stays
  // read-only. Git is the only writer of content to production.
  if (process.env.CONTENT_READONLY && method !== 'GET') {
    return { status: 403, body: { error: 'Content is read-only on production — author locally and ship via git.' } };
  }
  if (!auth || !DEV_ROLES.includes(auth.role)) {
    return { status: 403, body: { error: 'Dev access required' } };
  }

  if (path === '/staging/stage' && method === 'POST') return stage(body, auth);
  if (path === '/staging/pending' && method === 'GET') return getPending();
  if (path === '/staging/publish' && method === 'POST') return publish(body, auth);
  if (path === '/staging/reject' && method === 'POST') return reject(body, auth);
  if (path === '/staging/resolve' && method === 'POST') return resolve(body, auth);
  if (path === '/staging/deployments' && method === 'GET') return getDeployments();
  return null;
}

async function getAuthorHandle(auth) {
  try {
    const { rows } = await query('SELECT handle FROM players WHERE id=$1', [auth.playerId]);
    return rows[0]?.handle || auth.playerId;
  } catch { return auth.playerId; }
}

async function stage(body, auth) {
  const { entityType, entityId, entityName, changeType, method, apiPath, requestBody, description } = body;
  if (!entityType || !entityId || !apiPath) {
    return { status: 400, body: { error: 'entityType, entityId, and apiPath are required' } };
  }
  const author = await getAuthorHandle(auth);
  await query(`
    INSERT INTO staged_changes
      (id, entity_type, entity_id, entity_name, change_type, method, api_path, staged_data, description, author, staged_at)
    VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      entity_name   = EXCLUDED.entity_name,
      -- Collapse-safe merge. A pending CREATE followed by partial UPDATEs must stay a
      -- CREATE (and vice-versa if they arrive out of order) — otherwise the create is
      -- dropped and publish runs an UPDATE against a row that doesn't exist yet (0 rows,
      -- no error) and the entity is silently never created. This is the terrain painter's
      -- exact pattern: POST a new tile, then PUT its exits via neighbour wiring — which is
      -- why clustered new tiles randomly vanished on publish. A delete supersedes all.
      change_type   = CASE
        WHEN EXCLUDED.change_type = 'delete' THEN 'delete'
        WHEN staged_changes.change_type = 'create' OR EXCLUDED.change_type = 'create' THEN 'create'
        ELSE EXCLUDED.change_type END,
      -- When collapsing onto a create, keep the create's route (e.g. POST /zones), not the update's PUT.
      method        = CASE
        WHEN EXCLUDED.change_type <> 'delete' AND (staged_changes.change_type = 'create' OR EXCLUDED.change_type = 'create')
          THEN CASE WHEN EXCLUDED.change_type = 'create' THEN EXCLUDED.method ELSE staged_changes.method END
        ELSE EXCLUDED.method END,
      api_path      = CASE
        WHEN EXCLUDED.change_type <> 'delete' AND (staged_changes.change_type = 'create' OR EXCLUDED.change_type = 'create')
          THEN CASE WHEN EXCLUDED.change_type = 'create' THEN EXCLUDED.api_path ELSE staged_changes.api_path END
        ELSE EXCLUDED.api_path END,
      -- Accumulate partial writes (shallow jsonb merge, newest key wins) rather than replacing,
      -- so a create body keeps its fields when a later {exits}-only PUT lands, and an {exits}
      -- update followed by a {flags} update keeps both. A delete carries only the incoming body.
      staged_data   = CASE
        WHEN EXCLUDED.change_type = 'delete' THEN EXCLUDED.staged_data
        ELSE COALESCE(staged_changes.staged_data, '{}'::jsonb) || COALESCE(EXCLUDED.staged_data, '{}'::jsonb) END,
      description   = EXCLUDED.description,
      author        = EXCLUDED.author,
      staged_at     = NOW()
  `, [entityType, entityId, entityName || entityId, changeType || 'update',
      method || 'PUT', apiPath, JSON.stringify(requestBody || {}),
      description || `${changeType || 'update'} ${entityType} "${entityName || entityId}"`,
      author]);

  const { rows } = await query(
    'SELECT id FROM staged_changes WHERE entity_type=$1 AND entity_id=$2',
    [entityType, entityId]
  );
  return { status: 200, body: { staged: true, id: rows[0]?.id } };
}

async function getPending() {
  const { rows } = await query('SELECT * FROM staged_changes ORDER BY staged_at DESC');
  return { status: 200, body: { changes: rows.map(formatChange) } };
}

function formatChange(r) {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityName: r.entity_name,
    changeType: r.change_type,
    method: r.method,
    apiPath: r.api_path,
    stagedData: r.staged_data,
    description: r.description,
    author: r.author,
    stagedAt: r.staged_at,
  };
}

const UPDATERS = {
  zone:      (id, data) => apiUpdateZone(id, data),
  enemy:     (id, data) => apiUpdateEnemy(id, data),
  item:      (id, data) => apiUpdateItem(id, data),
  npc:       (id, data) => apiUpdateNpc(id, data),
  furniture: (id, data) => apiUpdateFurniture(id, data),
  recipe:    (id, data) => apiUpdateRecipe(id, data),
  mutation:  (id, data) => apiUpdateMutation(id, data),
  drug:      (id, data) => apiUpdateDrug(id, data),  scavenging_table: (id, data) => apiUpdateScavengingTable(id, data),
  // A grouped building relocation: apply every touched zone's patch, then rebuild the
  // facade entrance-dir cache. Published atomically as one change, so a building never
  // ends up half-moved by a partial publish.
  building_move: async (facadeId, data) => {
    const changes = data?.changes || [];
    for (const c of changes) {
      const r = await apiUpdateZone(c.id, c.patch || {});
      if (r?.body?.error) throw new Error(`${c.name || c.id}: ${r.body.error}`);
    }
    await reloadMaps();
    return { status: 200, body: { moved: changes.length } };
  },
  // A whole-region reposition: shift every member zone's grid coords. Published
  // atomically as one change so a region never ends up half-moved.
  region_move: async (regionId, data) => {
    const changes = data?.changes || [];
    for (const c of changes) {
      const r = await apiUpdateZone(c.id, c.patch || {});
      if (r?.body?.error) throw new Error(`${c.name || c.id}: ${r.body.error}`);
    }
    await reloadMaps();
    return { status: 200, body: { moved: changes.length } };
  },
};

const CREATORS = {
  zone:      (data) => apiCreateZone(data, null),
  // A whole new blank region: insert the regions row, then every tile, then
  // rebuild the map cache. One grouped change → the region appears atomically.
  region_create: async (data) => {
    const { region, zones } = data || {};
    const dr = await apiCreateRegion(region || {});
    if (dr?.body?.error) throw new Error(dr.body.error);
    // skipHooks so the zone-validator's async autoRepair can't strip a tile's exits to
    // siblings that aren't inserted yet — the fresh grid must stay internally connected.
    for (const z of (zones || [])) {
      const r = await apiCreateZone(z, null, { skipHooks: true });
      if (r?.body?.error) throw new Error(`${z.id}: ${r.body.error}`);
    }
    await reloadMaps();
    return { status: 200, body: { created: (zones || []).length } };
  },
  enemy:     (data) => apiCreateEnemy(data),
  item:      (data) => apiCreateItem(data),
  npc:       (data) => apiCreateNpc(data),
  furniture: (data) => apiCreateFurniture(data),  spawn:     (data) => apiCreateSpawn(data),
  scavenging_table: (data) => apiCreateScavengingTable(data),
};

// Allowed tables for orphan cleanup deletes. Maps table name → zone column.
const ORPHAN_TABLES = {
  furniture:       'zone_id',
  npcs:            'zone_id',
  zone_spawns:     'zone_id',
  generators:      'zone_id',
  power_zones:     'id',
  lighting_states: 'zone_id',  items:           'zone_id',
};

const DELETERS = {
  zone:           (id) => apiDeleteZone(id),
  enemy:          (id) => apiDeleteEnemy(id),
  item:           (id) => apiDeleteItem(id),
  npc:            (id) => apiDeleteNpc(id),
  furniture:      (id) => apiDeleteFurniture(id),
  generator:      (id) => removeGenerator(id).then(r => ({ status:200, body:r })),  spawn:          (id) => apiDeleteZoneSpawn(id),
  scavenging_table: (id) => apiDeleteScavengingTable(id),
  // Orphan cleanup: entity_id is "{table}:{refId}"
  orphan_cleanup: async (compositeId) => {
    const sep = compositeId.indexOf(':');
    const table = compositeId.slice(0, sep);
    const refId = compositeId.slice(sep + 1);
    const col = ORPHAN_TABLES[table];
    if (!col) throw new Error(`Unknown orphan table: ${table}`);
    const { rowCount } = await query(`DELETE FROM ${table} WHERE ${col}=$1`, [refId]);
    // generators/power_zones/lighting_states are mirrored in RAM by the power sim.
    if (table === 'generators' || table === 'power_zones' || table === 'lighting_states') markPowerTopologyDirty();
    return { status: 200, body: { deleted: rowCount } };
  },
};

async function applyChange(change) {
  if (change.change_type === 'create' && CREATORS[change.entity_type]) {
    const result = await CREATORS[change.entity_type](change.staged_data || {});
    if (result?.body?.error) throw new Error(result.body.error);
    return result;
  }
  if (change.change_type === 'delete' && DELETERS[change.entity_type]) {
    const result = await DELETERS[change.entity_type](change.entity_id);
    if (result?.body?.error) throw new Error(result.body.error);
    return result;
  }
  const updater = UPDATERS[change.entity_type];
  if (!updater) throw new Error(`No publisher for entity type: ${change.entity_type}`);
  const result = await updater(change.entity_id, change.staged_data || {});
  if (result?.body?.error) throw new Error(result.body.error);
  return result;
}

async function publish(body, auth) {
  const { ids, all } = body || {};
  const author = await getAuthorHandle(auth);

  let toPublish;
  if (all) {
    const { rows } = await query('SELECT * FROM staged_changes ORDER BY staged_at ASC');
    toPublish = rows;
  } else if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await query(`SELECT * FROM staged_changes WHERE id IN (${placeholders}) ORDER BY staged_at ASC`, ids);
    toPublish = rows;
  } else {
    return { status: 400, body: { error: 'Specify ids or all:true' } };
  }

  if (!toPublish.length) return { status: 200, body: { published: 0, message: 'Nothing to publish' } };

  const results = [];
  const errors = [];
  for (const change of toPublish) {
    try {
      await applyChange(change);
      results.push({ id: change.id, entityType: change.entity_type, entityName: change.entity_name });
    } catch (err) {
      errors.push({ id: change.id, entityName: change.entity_name, error: err.message });
    }
  }

  // Remove successfully published changes
  if (results.length) {
    const publishedIds = results.map(r => r.id);
    const placeholders = publishedIds.map((_, i) => `$${i + 1}`).join(',');
    await query(`DELETE FROM staged_changes WHERE id IN (${placeholders})`, publishedIds);
  }

  // Record deployment
  if (results.length) {
    await query(
      `INSERT INTO deployments (id, deployed_by, change_count, changes_summary)
       VALUES (gen_random_uuid()::text, $1, $2, $3)`,
      [author, results.length, JSON.stringify(results)]
    );
  }

  return {
    status: 200,
    body: {
      published: results.length,
      failed: errors.length,
      errors: errors.length ? errors : undefined,
      message: `Published ${results.length} change${results.length !== 1 ? 's' : ''}${errors.length ? `, ${errors.length} failed` : ''}`,
    },
  };
}

async function reject(body, auth) {
  const { ids, all } = body || {};

  if (all) {
    const { rowCount } = await query('DELETE FROM staged_changes');
    return { status: 200, body: { rejected: rowCount, message: `Rejected ${rowCount} change${rowCount !== 1 ? 's' : ''}` } };
  }

  if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rowCount } = await query(`DELETE FROM staged_changes WHERE id IN (${placeholders})`, ids);
    return { status: 200, body: { rejected: rowCount, message: `Rejected ${rowCount} change${rowCount !== 1 ? 's' : ''}` } };
  }

  return { status: 400, body: { error: 'Specify ids or all:true' } };
}

// Auto-resolve: retries failed changes with fallback strategy:
//   create that failed  → try update (entity already exists)
//   update that failed  → try create (entity was deleted)
//   delete that failed  → treat as already-gone, remove from staging
async function resolve(body) {
  const { ids } = body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return { status: 400, body: { error: 'Specify ids array' } };
  }
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await query(`SELECT * FROM staged_changes WHERE id IN (${placeholders})`, ids);

  const resolved = [];
  const errors = [];
  for (const change of rows) {
    try {
      if (change.change_type === 'delete') {
        // Already gone — just clear from staging
        resolved.push({ id: change.id, entityName: change.entity_name });
        continue;
      }
      if (change.change_type === 'create') {
        // Entity already exists — fall back to update
        const updater = UPDATERS[change.entity_type];
        if (!updater) throw new Error(`No updater for entity type "${change.entity_type}"`);
        const r = await updater(change.entity_id, change.staged_data || {});
        if (r?.body?.error) throw new Error(r.body.error);
      } else {
        // update failed — entity may be missing, try create
        const creator = CREATORS[change.entity_type];
        if (!creator) throw new Error(`No creator for entity type "${change.entity_type}"`);
        const r = await creator({ ...(change.staged_data || {}), id: change.entity_id });
        if (r?.body?.error) throw new Error(r.body.error);
      }
      resolved.push({ id: change.id, entityName: change.entity_name });
    } catch (err) {
      errors.push({ id: change.id, entityName: change.entity_name, error: err.message });
    }
  }

  if (resolved.length) {
    const phs = resolved.map((_, i) => `$${i + 1}`).join(',');
    await query(`DELETE FROM staged_changes WHERE id IN (${phs})`, resolved.map(r => r.id));
  }

  return {
    status: 200,
    body: {
      resolved,
      errors: errors.length ? errors : undefined,
      message: `Resolved ${resolved.length} of ${rows.length}${errors.length ? `, ${errors.length} still failed` : ''}`,
    },
  };
}

async function getDeployments() {
  const { rows } = await query('SELECT * FROM deployments ORDER BY deployed_at DESC LIMIT 3');
  return {
    status: 200,
    body: {
      deployments: rows.map(r => ({
        id: r.id,
        deployedAt: r.deployed_at,
        deployedBy: r.deployed_by,
        changeCount: r.change_count,
        changes: r.changes_summary || [],
      })),
    },
  };
}
