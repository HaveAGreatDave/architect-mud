import { getAllZones } from '../../server/engine/world.js';
import { findPath } from '../../server/engine/pathfinding.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { registerAction } from '../../server/engine/actions.js';

// Shared by the direct match and the SIFT-disambiguation replay (gps.navigate).
function plotRoute(player, destZone) {
  if (destZone.id === player.current_zone) {
    return { type: 'output', message: `You're already at ${destZone.name}.` };
  }
  const path = findPath(player.current_zone, destZone.id);
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
  };
}

function cmdGps(args, raw, player) {
  const query = (args || []).join(' ').trim();
  if (!query) return { type: 'error', message: 'GPS to where? Try: gps <part of a location name>' };

  const r = siftResolve(query, getAllZones());
  if (r.type === 'none') return { type: 'error', message: `No location matching "${query}".` };
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

export const commands = { gps: cmdGps };
