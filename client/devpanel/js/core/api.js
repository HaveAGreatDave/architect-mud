const STAGED_ENTITY_TYPES = {
  '/zones': 'zone', '/enemies': 'enemy', '/items': 'item', '/npcs': 'npc',
  '/furniture': 'furniture', '/recipes': 'recipe', '/mutations': 'mutation', '/drugs': 'drug',
  '/windows': 'window', '/scavenging-tables': 'scavenging_table',
};

function getEntityType(path) {
  for (const [prefix, type] of Object.entries(STAGED_ENTITY_TYPES)) {
    if (path === prefix || path.startsWith(prefix + '/')) return type;
  }
  return null;
}

// ── Ops-mode read-only panels ────────────────────────────────────────────────
// A few content panels are useful to LOOK at on production (what's on air right
// now, which channel owns which studio) even though production accepts no content
// writes — git is the only writer (CONTENT_READONLY, see server/api/routes.js).
// Those panels are kept in the /admin nav and their writes are refused HERE, with
// a sentence that says where to make the edit, rather than letting the button fire
// and come back as a bare 403.
// '/spawns' rides with '/enemies': zone_spawns is authored content too, and the
// Spawn Map's clickable tiles post to it.
const OPS_READONLY_PREFIXES = ['/broadcast', '/zones', '/npcs', '/items', '/enemies', '/spawns'];
// …except the live-ops actions that live INSIDE those panels and are allowlisted
// server-side (OPS_ROUTES in server/api/routes.js). Spawning a live enemy or
// restocking a vendor is runtime state, not authored content — it's the reason
// some of these panels are worth having on prod at all. Keep in step with the
// server list; this is the UI half of the same rule.
const OPS_READONLY_EXCEPTIONS = [
  /^\/zones\/[^/]+\/live-enemies$/,
  /^\/npcs\/[^/]+\/(restock|place-safe)$/,
];
function opsReadonlyBlocks(path, method) {
  if (!window.OPS_MODE) return false;
  if (method === 'GET' || method === 'HEAD') return false;
  if (OPS_READONLY_EXCEPTIONS.some(re => re.test(path))) return false;
  return OPS_READONLY_PREFIXES.some(p => path === p || path.startsWith(p + '/'));
}
const OPS_READONLY_ERROR = 'Read-only on production. World content is edited locally and ships through the CODEX deploy (push to main) — nothing saved here would survive the next deploy anyway.';

const API = async (path, method = 'GET', body = null) => {
  if (opsReadonlyBlocks(path, method)) return { error: OPS_READONLY_ERROR };
  const authHeaders = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  // Intercept entity writes and route them to staging.
  // Excluded: sub-resource operations (rooms, build) and complex multi-step paths.
  const STAGING_EXCLUDED = [/\/zones\/.+\/rooms/, /\/zones\/.+\/live-enemies/, /\/apartments\/build/, /\/apartments\//, /\/furniture\/bulk/];
  const entityType = getEntityType(path);
  const excluded = STAGING_EXCLUDED.some(re => re.test(path));
  if (stagingEnabled && entityType && !excluded && ['POST', 'PUT', 'DELETE'].includes(method)) {
    const parts = path.split('/');
    // Entity IDs may contain slashes (e.g. "ksab/studio_stage"), so grab everything
    // after the entity-type segment rather than just parts[2].
    const entityPrefix = '/' + parts[1] + '/';
    const rawId = path.startsWith(entityPrefix) ? path.slice(entityPrefix.length) : parts[2];
    const entityId = rawId || body?.id || `new_${Date.now()}`;
    const entityName = (method !== 'DELETE' ? (body?.name || currentRecord?.name) : currentRecord?.name) || entityId;
    const changeType = method === 'DELETE' ? 'delete' : method === 'POST' ? 'create' : 'update';
    const description = `${changeType[0].toUpperCase() + changeType.slice(1)}d ${entityType} "${entityName}"`;
    try {
      const res = await fetch('/api/staging/stage', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ entityType, entityId, entityName, changeType, method, apiPath: path, requestBody: body, description }),
      });
      return res.json();
    } catch (err) {
      return { error: `Staging error: ${err.message}` };
    }
  }

  const opts = { method, headers: authHeaders };
  if (body) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch (err) {
    // Network failure — server unreachable, cold start, CORS, etc.
    return { error: `Network error: ${err.message}` };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { error: `Server returned an unreadable response (status ${res.status})` };
  }

  if (!res.ok) {
    // Surface the server's error message if present, otherwise the status
    if (res.status === 403) {
      return { error: data.error || 'Access denied — your session may have expired. Please log in again.' };
    }
    return { error: data.error || `Request failed (status ${res.status})` };
  }

  return data;
};

// Direct API call that bypasses the staging pipeline — for immediate live-world actions.
const directAPI = (path, method = 'GET', body = null) => {
  if (opsReadonlyBlocks(path, method)) return Promise.resolve({ error: OPS_READONLY_ERROR });
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`/api${path}`, opts)
    .then(r => r.json())
    .catch(err => ({ error: err.message }));
};

