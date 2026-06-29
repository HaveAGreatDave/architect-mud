import { fireHook, getLoadedPlugins, getRegisteredHooks } from '../engine/plugins.js';

const DEV_ROLES = ['dev', 'admin', 'builder', 'designer'];

export async function handleWorldValidatorApi(path, method, body, auth) {
  if (!path.startsWith('/worldvalidator')) return null;

  if (!auth || !DEV_ROLES.includes(auth.role)) {
    return { status: 403, body: { error: 'Dev access required' } };
  }

  try {
    if (path === '/worldvalidator/status' && method === 'GET') {
      return { status: 200, body: {
        loadedPlugins: getLoadedPlugins(),
        registeredHooks: getRegisteredHooks(),
      }};
    }

    if (path === '/worldvalidator/run-full' && method === 'POST') {
      const hooks = getRegisteredHooks();
      if (!hooks['worldValidator.runFull']?.length) {
        return { status: 503, body: { error: 'zone-validator plugin not loaded', loadedPlugins: getLoadedPlugins() } };
      }
      let runError = null;
      const result = await fireHook('worldValidator.runFull', body || {}).catch(e => { runError = e; return null; });
      if (runError) return { status: 500, body: { error: `Validator threw: ${runError.message}` } };
      if (result == null) return { status: 503, body: { error: 'zone-validator plugin not loaded', loadedPlugins: getLoadedPlugins() } };
      return { status: 200, body: result };
    }

    if (path === '/worldvalidator/run-zone' && method === 'POST') {
      const { zoneId, ...opts } = body || {};
      if (!zoneId) return { status: 400, body: { error: 'zoneId required' } };
      const result = await fireHook('worldValidator.runZone', zoneId, opts);
      if (result == null) return { status: 503, body: { error: 'zone-validator plugin not loaded' } };
      return { status: 200, body: result };
    }

  } catch (err) {
    return { status: 500, body: { error: err.message || 'Validation error' } };
  }

  return null;
}
