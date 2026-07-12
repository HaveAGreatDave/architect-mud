import { getAllZones, getZone } from '../../server/engine/world.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction } from '../../server/engine/actions.js';

// Shared by the direct match and the SIFT-disambiguation replay (gps.navigate).
function plotRoute(player, destZone) {
  // Open water isn't a place you can stand — you can't route to it, and it's hidden
  // from name resolution below so it never even surfaces as a candidate.
  if (destZone.flags?.water) {
    return { type: 'error', message: 'Must be on Land.' };
  }
  if (destZone.id === player.current_zone) {
    return { type: 'output', message: `You're already at ${destZone.name}.` };
  }
  // Road-preferring route: hug the street grid, leaving it only for the start/end building.
  // maxDistance is generous because sticking to roads adds hops vs. a straight cut-through.
  const path = findPath(player.current_zone, destZone.id, { roads: true, maxDistance: 200 });
  if (!path || path.length < 2) {
    return { type: 'error', message: `Can't find a path to ${destZone.name} from here.` };
  }
  const hops = path.length - 1;
  // type: 'gps_route' carries the zone-id path down to the client, which feeds it
  // straight into the existing route-trace overlay (client/game/js/panels/minimap.js)
  // shared by the sidebar minimap and the full map popup.
  return {
    type: 'gps_route',
    message: `GPS locked: ${destZone.name} (${hops} stop${hops === 1 ? '' : 's'} away). Route plotted on the map.`,
    path,
    // If the player is already auto-walking (armed), a fresh plot continues the walk
    // on the new corridor — this is what lets an off-course auto-walker re-plot from
    // its new position and get back on track. Harmless when not armed (the client
    // only resumes an armed walk).
    resumeAuto: true,
    // Manual `gps` plots (this path only — quest/tablet routes build their own
    // gps_route without this flag) ask the player whether to auto-walk there now.
    // The client appends the y/n question and arms a one-shot prompt.
    promptAutoWalk: true,
  };
}

// Straight-line grid distance² between two tiles (no sqrt — we only compare).
// Infinity when either lacks grid coords, so those sort last.
function gridDist(a, b) {
  if (!a || !b || a.grid_x == null || b.grid_x == null) return Infinity;
  const dx = a.grid_x - b.grid_x, dy = a.grid_y - b.grid_y;
  return dx * dx + dy * dy;
}

// Option D — many tiles legitimately share one name: filler terrain ("Grasslands"),
// or a street that spans a dozen tiles ("Halcyon Boulevard"). Any one of them is as
// good a destination as another, so route to the NEAREST reachable one instead of
// popping an unusable N-row picker (or, worse, tie-break-routing to a far tile).
function routeToNearest(player, candidates) {
  const here = getZone(player.current_zone);
  const sorted = candidates
    .filter(z => z.id !== player.current_zone)
    .sort((a, b) => gridDist(here, a) - gridDist(here, b));
  // plotRoute runs the real road-preferring pathfind; grid distance only orders the
  // attempts. Try the closest few so an unreachable nearest tile falls through to the
  // next — bounded so a name matching hundreds of tiles never fans out hundreds of BFS.
  for (const z of sorted.slice(0, 8)) {
    const res = plotRoute(player, z);
    if (res.type === 'gps_route') return res;
  }
  return sorted.length
    ? plotRoute(player, sorted[0]) // surface its concrete error (e.g. can't find a path)
    : { type: 'error', message: 'No reachable tile of that name.' };
}

// Option A (backup) — a direct handle to one exact tile, bypassing name matching:
// a full zone id, or "x,y" / "x y" grid coordinates on the player's current map+level.
// The map popup shows these coords, so this is the power-user way to hit a precise tile.
function resolveDirect(query, player) {
  const byId = getZone(query) || getZone(query.toLowerCase());
  if (byId) return byId;
  const m = query.match(/^(-?\d+)\s*[ ,]\s*(-?\d+)$/);
  if (m) {
    const here = getZone(player.current_zone);
    const gx = +m[1], gy = +m[2];
    return getAllZones().find(z =>
      z.grid_x === gx && z.grid_y === gy &&
      z.map_id === here?.map_id && (z.grid_z ?? 0) === (here?.grid_z ?? 0)) || null;
  }
  return null;
}

function cmdGps(args, raw, player) {
  const query = (args || []).join(' ').trim();
  if (!query) return { type: 'error', message: 'GPS to where? Try: gps <part of a location name>' };

  // Standing in a tile whose exact name you typed? You're already there. Resolve self
  // first so identically-named tiles (many "Grasslands" etc.) don't route you to a
  // same-named neighbour instead of recognising the one you're on.
  const hereZone = getZone(player.current_zone);
  if (hereZone && String(hereZone.name || '').trim().toLowerCase() === query.toLowerCase())
    return { type: 'output', message: `You're already at ${hereZone.name}.` };

  // Option A: an exact zone id or grid coordinate resolves straight to one tile.
  const direct = resolveDirect(query, player);
  if (direct) return plotRoute(player, direct);

  // Water tiles are invisible to GPS — they can't be a destination (Coldwater Basin and
  // its ilk would otherwise clutter every name match), so drop them before resolving.
  const landZones = getAllZones().filter(z => !z.flags?.water);

  // Option D: the typed name is an exact match for several tiles (terrain / a long
  // street). Route to the nearest rather than SIFT's tie-break pick or a dead picker.
  const q = query.toLowerCase();
  const sameName = landZones.filter(z => String(z.name || '').trim().toLowerCase() === q);
  if (sameName.length > 1) return routeToNearest(player, sameName);

  const r = siftResolve(query, landZones);
  if (r.type === 'none') return { type: 'error', message: `No location matching "${query.replace(/^["']|["']$/g, '')}".` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType: 'gps.navigate', dispatchParam: 'destination' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  return plotRoute(player, r.candidate);
}

registerAction({
  type: 'gps.navigate',
  handler: ({ actor, params }) => plotRoute(actor, params.destination),
});

// Run mode: a runtime-only flag on the live player (never a DB column — it's
// transient movement state, resets to walk on relog). movement.js reads it to
// charge the per-step stamina toll; the client mirrors `running` onto the minimap
// Run button and paces GPS auto-walk off it. Bare `run` toggles; `run on|off` and
// the `walk` alias set it explicitly.
function setRunning(player, running) {
  player.running = running;
  return {
    type: 'run_state',
    running,
    message: running
      ? 'You break into a run — faster, but it burns stamina.'
      : 'You slow to a walk.',
  };
}
function cmdRun(args, raw, player) {
  const arg = (args || [])[0]?.toLowerCase();
  const running = arg === 'on' || arg === 'start' ? true
    : arg === 'off' || arg === 'stop' ? false
    : !player.running;
  return setRunning(player, running);
}
function cmdWalk(args, raw, player) { return setRunning(player, false); }

export const commands = { gps: cmdGps, run: cmdRun, walk: cmdWalk };
