// server/api/environment.routes.js
//
// Dev-panel / REST endpoints for the Environmental Systems feature.
//
// Written for this codebase's actual stack — plain Node `http`, no framework
// (package.json has no express/body-parser) — so it exposes a single async
// dispatcher rather than route-decorator syntax.
//
// Wire it into the existing dispatcher in server/api/routes.js, before the
// final 404 fallthrough:
//
//   import { handleEnvironmentRoute } from './environment.routes.js';
//   ...
//   if (await handleEnvironmentRoute(req, res, pathname, method)) return;
//
// Routes assume admin/dev-role auth has already happened upstream — same
// assumption the rest of the dev panel API makes per docs/architecture.md.

import * as env from '../engine/environment.js';

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

// Same gotcha documented in docs/architecture.md's Lessons Learned: Postgres
// INTEGER columns reject JS true/false, so booleans get coerced explicitly
// before anything reaches a query.
function boolToInt(v) { return v ? 1 : 0; }

export async function handleEnvironmentRoute(req, res, pathname, method) {
  try {
    if (pathname === '/api/environment/state' && method === 'GET') {
      sendJSON(res, 200, env.getEnvironmentState());
      return true;
    }

    if (pathname === '/api/environment/forecast' && method === 'GET') {
      sendJSON(res, 200, env.getForecast());
      return true;
    }

    if (pathname === '/api/environment/power/map' && method === 'GET') {
      sendJSON(res, 200, env.getPowerMap());
      return true;
    }

    if (pathname.startsWith('/api/environment/visibility/') && method === 'GET') {
      const zoneId = decodeURIComponent(pathname.split('/').pop());
      sendJSON(res, 200, env.getZoneVisibility(zoneId));
      return true;
    }

    if (pathname === '/api/environment/time/set' && method === 'POST') {
      const body = await readJSONBody(req);
      sendJSON(res, 200, await env.devSetTime(body));
      return true;
    }

    if (pathname === '/api/environment/time/advance' && method === 'POST') {
      const body = await readJSONBody(req);
      sendJSON(res, 200, await env.devAdvanceTime(body.minutes));
      return true;
    }

    if (pathname === '/api/environment/time/freeze' && method === 'POST') {
      const body = await readJSONBody(req);
      sendJSON(res, 200, env.devFreeze(boolToInt(body.frozen)));
      return true;
    }

    if (pathname === '/api/environment/tick/force30' && method === 'POST') {
      sendJSON(res, 200, await env.devForceTick30());
      return true;
    }

    if (pathname === '/api/environment/tick/force24' && method === 'POST') {
      sendJSON(res, 200, await env.devForceTick24());
      return true;
    }

    if (pathname === '/api/environment/weather/override' && method === 'POST') {
      const body = await readJSONBody(req);
      sendJSON(res, 200, await env.devOverrideWeather(body));
      return true;
    }

    if (pathname === '/api/environment/weather/storm' && method === 'POST') {
      sendJSON(res, 200, await env.devTriggerStorm());
      return true;
    }

    if (pathname === '/api/environment/weather/snow' && method === 'POST') {
      sendJSON(res, 200, await env.devTriggerSnow());
      return true;
    }

    if (pathname === '/api/environment/forecast/lock' && method === 'POST') {
      const body = await readJSONBody(req);
      sendJSON(res, 200, await env.devLockForecastDay(Number(body.day), !!body.locked));
      return true;
    }

    if (pathname === '/api/environment/power/generator' && method === 'POST') {
      const body = await readJSONBody(req);
      sendJSON(res, 200, await env.devSpawnGenerator(body));
      return true;
    }

    if (pathname === '/api/environment/power/load' && method === 'POST') {
      const body = await readJSONBody(req);
      sendJSON(res, 200, await env.devModifyLoad(body.zoneId, body.loadKw));
      return true;
    }

    if (pathname === '/api/environment/power/fail' && method === 'POST') {
      const body = await readJSONBody(req);
      sendJSON(res, 200, await env.devSimulateFailure(body.generatorId));
      return true;
    }

    return false; // not an environment route — let the caller fall through
  } catch (err) {
    // Same pattern as every other dev-panel write path: a bad request
    // surfaces as a toast in the dev panel, never crashes the process.
    sendJSON(res, 400, { error: err.message || 'Environment route error' });
    return true;
  }
}
