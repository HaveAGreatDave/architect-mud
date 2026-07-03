// server/api/environment.routes.js
//
// Environment (time/weather/power/lighting) API.
//
// Matches this codebase's REAL dispatcher pattern in server/api/routes.js —
// NOT raw req/res. handleApiRequest(url, method, body, headers) already
// strips the leading /api, parses the JSON body, and resolves auth before
// any route sees it, and every route just returns {status, body}; index.js
// is what actually writes the HTTP response. This file mirrors that.
//
// Wiring (already done if you're reading this after the fix):
//   server/api/routes.js, near the top:
//     import { handleEnvironmentApi } from './environment.routes.js';
//   inside handleApiRequest(), right after `const auth = verifyToken(headers);`:
//     const envResult = await handleEnvironmentApi(path, method, body, auth);
//     if (envResult) return envResult;

import * as env from '../engine/environment.js';

const DEV_ROLES = ['dev', 'admin', 'builder', 'designer'];

function requireDevAuth(auth) {
  if (!auth || !DEV_ROLES.includes(auth.role)) {
    return { status: 403, body: { error: 'Dev access required' } };
  }
  return null;
}

// Returns {status, body} if this was an environment route, or null so
// handleApiRequest falls through to its own routes.
export async function handleEnvironmentApi(path, method, body, auth) {
  if (path === '/environment/state' && method === 'GET') {
    return { status: 200, body: env.getEnvironmentState() };
  }

  if (path === '/environment/forecast' && method === 'GET') {
    return { status: 200, body: env.getForecast() };
  }

  if (path === '/environment/weathermap' && method === 'GET') {
    return { status: 200, body: await env.getWeatherMap() };
  }

  if (path === '/environment/climate/profiles' && method === 'GET') {
    const denied = requireDevAuth(auth);
    if (denied) return denied;
    return { status: 200, body: await env.devGetClimateProfiles() };
  }

  if (path === '/environment/power/map' && method === 'GET') {
    return { status: 200, body: env.getPowerMap() };
  }

  if (path.startsWith('/environment/power/zones/') && method === 'GET') {
    const zoneId = decodeURIComponent(path.split('/')[4] || '');
    return { status: 200, body: await env.getZonePowerInfo(zoneId) };
  }

  if (path === '/environment/power/generators' && method === 'GET') {
    return { status: 200, body: await env.getGeneratorsList() };
  }

  if (path === '/environment/power/city-generators' && method === 'GET') {
    return { status: 200, body: await env.getCityGenerators() };
  }

  if (path.startsWith('/environment/power/generators/') && path.endsWith('/zones') && method === 'GET') {
    const parts = path.split('/'); // ['', 'environment', 'power', 'generators', id, 'zones']
    const genId = decodeURIComponent(parts[4] || '');
    return { status: 200, body: await env.getGeneratorZones(genId) };
  }

  if (path.startsWith('/environment/visibility/') && method === 'GET') {
    const zoneId = decodeURIComponent(path.split('/')[3] || '');
    return { status: 200, body: env.getZoneVisibility(zoneId) };
  }

  // Everything past this point changes world state — dev/admin only,
  // same role check as zones/enemies/items/etc. elsewhere in routes.js.
  if (path.startsWith('/environment/') && (method === 'POST' || method === 'DELETE')) {
    const denied = requireDevAuth(auth);
    if (denied) return denied;

    try {
      if (path === '/environment/time/set') return { status: 200, body: await env.devSetTime(body || {}) };
      if (path === '/environment/time/advance') return { status: 200, body: await env.devAdvanceTime(body?.minutes) };
      if (path === '/environment/time/freeze') return { status: 200, body: env.devFreeze(body?.frozen ? 1 : 0) };
      if (path === '/environment/time/scale') return { status: 200, body: await env.devSetTimeScale(Number(body?.scale), auth) };
      if (path === '/environment/climate/profiles' && method === 'POST') return { status: 200, body: await env.devSaveClimateProfile(body || {}) };
      if (path === '/environment/climate/active' && method === 'POST') return { status: 200, body: await env.devSetActiveClimate(body?.id || null) };
      if (path === '/environment/climate/recalculate' && method === 'POST') return { status: 200, body: await env.devRecalculateForecast(body || {}) };
      if (path.startsWith('/environment/climate/profiles/') && method === 'DELETE') {
        const id = decodeURIComponent(path.split('/')[4] || '');
        return { status: 200, body: await env.devDeleteClimateProfile(id) };
      }
      if (path === '/environment/tick/force5')  return { status: 200, body: await env.devForceTick5() };
      if (path === '/environment/tick/force30') return { status: 200, body: await env.devForceTick30() };
      if (path === '/environment/tick/force24') return { status: 200, body: await env.devForceTick24() };
      if (path === '/environment/weather/override' && method === 'POST') return { status: 200, body: await env.devOverrideWeather(body || {}) };
      if (path === '/environment/weather/schedule' && method === 'POST') return { status: 200, body: await env.devScheduleForecastDay(body || {}) };
      if (path === '/environment/weather/override' && method === 'DELETE') return { status: 200, body: await env.devClearWeatherOverride() };
      if (path === '/environment/weather/reset-building-temps' && method === 'POST') return { status: 200, body: env.devResetBuildingTemps() };
      if (path === '/environment/weather/maxstorm') return { status: 200, body: await env.devMaxStorm() };
      if (path === '/environment/weather/storm') return { status: 200, body: await env.devTriggerStorm() };
      if (path === '/environment/weather/snow') return { status: 200, body: await env.devTriggerSnow() };
      if (path === '/environment/power/generator') return { status: 200, body: await env.devSpawnGenerator(body || {}) };
      if (path === '/environment/power/load') return { status: 200, body: await env.devModifyLoad(body?.zoneId, body?.loadKw) };
      if (path === '/environment/power/fail') return { status: 200, body: await env.devSimulateFailure(body?.generatorId) };
      if (path === '/environment/power/install' && method === 'POST') return { status: 200, body: await env.installGenerator(body || {}) };
      if (path === '/environment/power/fix-zones' && method === 'POST') return { status: 200, body: await env.fixZonePowerConnections() };
      if (path === '/environment/power/resync-lighting' && method === 'POST') return { status: 200, body: await env.resyncAllLightingStates() };
      if (path === '/environment/power/fix-buildings' && method === 'POST') return { status: 200, body: await env.fixBuildingPowerConnections() };
      if (path === '/environment/power/auto-resolve' && method === 'POST') return { status: 200, body: await env.autoResolvePower() };
      if (path === '/environment/power/recompute' && method === 'POST') return { status: 200, body: await env.recomputePower() };
      if (path.startsWith('/environment/power/generators/') && path.endsWith('/capacity') && method === 'POST') {
        const genId = decodeURIComponent(path.split('/')[4] || '');
        return { status: 200, body: await env.setGeneratorCapacity(genId, body?.capacityKw, body?.name) };
      }
      if (path.startsWith('/environment/power/generators/') && path.endsWith('/toggle') && method === 'POST') {
        const genId = decodeURIComponent(path.split('/')[4] || '');
        return { status: 200, body: await env.toggleGeneratorStatus(genId) };
      }
      if (path.startsWith('/environment/power/zones/') && path.endsWith('/reassign') && method === 'POST') {
        const zoneId = decodeURIComponent(path.split('/')[4] || '');
        return { status: 200, body: await env.reassignZoneGenerator(zoneId, body?.generatorId) };
      }
      if (path.startsWith('/environment/power/zones/') && path.endsWith('/assign-jb') && method === 'POST') {
        const zoneId = decodeURIComponent(path.split('/')[4] || '');
        return { status: 200, body: await env.assignZoneToJunctionBox(zoneId, body?.generatorId) };
      }
      if (path.startsWith('/environment/power/zones/') && method === 'POST') {
        const zoneId = decodeURIComponent(path.split('/')[4] || '');
        return { status: 200, body: await env.setZoneMaxCapacity(zoneId, body?.maxCapacityKw) };
      }
      if (path.startsWith('/environment/power/generators/') && path.endsWith('/city-generator') && method === 'POST') {
        const genId = decodeURIComponent(path.split('/')[4] || '');
        return { status: 200, body: await env.setJunctionBoxCityGenerator(genId, body?.cityGeneratorId) };
      }
      if (path.startsWith('/environment/power/generators/') && method === 'DELETE') {
        return { status: 200, body: await env.removeGenerator(decodeURIComponent(path.split('/')[4] || '')) };
      }
    } catch (err) {
      return { status: 400, body: { error: err.message || 'Environment route error' } };
    }
  }

  return null;
}
