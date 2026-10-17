// ── Ops-mode writes ──────────────────────────────────────────────────────────
// The server's CONTENT_READONLY gate is DEFAULT-DENY: every read passes, and a
// write passes only if it's a live-ops route. This mirrors that shape rather than
// listing the content prefixes, which is what lets /admin carry the SAME sidebar
// /dev carries — on production a content panel is simply a viewer, and any write
// it could still offer is refused here with a sentence that says where to make the
// edit instead of a bare 403 coming back from the server.
// Keep in step with OPS_ROUTES / ENV_OPS_ROUTES in server/api/routes.js — this is
// the UI half of the same rule.
const OPS_WRITE_ROUTES = [
  /^\/auth\//,
  /^\/players(\/|$)/,
  /^\/admin\/presence$/,
  /^\/channels\//,
  /^\/ghost\/token$/,
  /^\/mis\//, /^\/email-verification\//, /^\/registrations\//,
  /^\/world\/reload$/,
  /^\/motd(\/|$)/,
  /^\/dev\//,
  /^\/spawn$/,
  /^\/live-enemies\//,
  /^\/zones\/[^/]+\/live-enemies$/,   // runtime spawn, not zone_spawns
  /^\/npcs\/[^/]+\/(restock|place-safe)$/,
  /^\/gametable(\/|$)/,
  /^\/emergency(\/|$)/,
  /^\/atm\/units(\/|$)/,
  /^\/flight\/aircraft(\/|$)/,
  // Environment is default-deny too; only these are live-ops.
  /^\/environment\/time\//,
  /^\/environment\/weather\//,
  /^\/environment\/tick\/force/,
  /^\/environment\/power\/(recompute|load|fail|resync-lighting)$/,
];
function opsReadonlyBlocks(path, method) {
  if (!window.OPS_MODE) return false;
  if (method === 'GET' || method === 'HEAD') return false;
  return !OPS_WRITE_ROUTES.some(re => re.test(path));
}
const OPS_READONLY_ERROR = 'Read-only on production. World content is edited locally and ships through the CODEX deploy (push to main) — nothing saved here would survive the next deploy anyway.';

const API = async (path, method = 'GET', body = null) => {
  if (opsReadonlyBlocks(path, method)) return { error: OPS_READONLY_ERROR };
  const authHeaders = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

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

// The same call without the error shaping, for live-world actions that want the raw reply.
const directAPI = (path, method = 'GET', body = null) => {
  if (opsReadonlyBlocks(path, method)) return Promise.resolve({ error: OPS_READONLY_ERROR });
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`/api${path}`, opts)
    .then(r => r.json())
    .catch(err => ({ error: err.message }));
};

