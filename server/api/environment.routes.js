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

  if (path === '/environment/power/map' && method === 'GET') {
    return { status: 200, body: env.getPowerMap() };
  }

  if (path.startsWith('/environment/visibility/') && method === 'GET') {
    const zoneId = decodeURIComponent(path.split('/')[3] || '');
    return { status: 200, body: env.getZoneVisibility(zoneId) };
  }

  // Everything past this point changes world state — dev/admin only,
  // same role check as zones/enemies/items/etc. elsewhere in routes.js.
  if (path.startsWith('/environment/') && method === 'POST') {
    const denied = requireDevAuth(auth);
    if (denied) return denied;

    try {
      if (path === '/environment/time/set') return { status: 200, body: await env.devSetTime(body || {}) };
      if (path === '/environment/time/advance') return { status: 200, body: await env.devAdvanceTime(body?.minutes) };
      if (path === '/environment/time/freeze') return { status: 200, body: env.devFreeze(body?.frozen ? 1 : 0) };
      if (path === '/environment/tick/force30') return { status: 200, body: await env.devForceTick30() };
      if (path === '/environment/tick/force24') return { status: 200, body: await env.devForceTick24() };
      if (path === '/environment/weather/override') return { status: 200, body: await env.devOverrideWeather(body || {}) };
      if (path === '/environment/weather/storm') return { status: 200, body: await env.devTriggerStorm() };
      if (path === '/environment/weather/snow') return { status: 200, body: await env.devTriggerSnow() };
      if (path === '/environment/forecast/lock') return { status: 200, body: await env.devLockForecastDay(Number(body?.day), !!body?.locked) };
      if (path === '/environment/power/generator') return { status: 200, body: await env.devSpawnGenerator(body || {}) };
      if (path === '/environment/power/load') return { status: 200, body: await env.devModifyLoad(body?.zoneId, body?.loadKw) };
      if (path === '/environment/power/fail') return { status: 200, body: await env.devSimulateFailure(body?.generatorId) };
    } catch (err) {
      return { status: 400, body: { error: err.message || 'Environment route error' } };
    }
  }

  return null;
}
