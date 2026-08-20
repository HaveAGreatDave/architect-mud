// THE HIGHWAY, IN THE SIDEBAR MAP.
//
// The sidebar minimap and the cab GPS were rendering two different kinds of thing. The cab eats
// DERIVED SURFACE CELLS (`v.map` — the same objects the building pass reads, which is why a road is
// a road there because it is a road out there). The sidebar eats `msg.minimap`, a graph of zone
// NODES from getMinimapData. Out on a crossing those nodes are transient void rooms, so a driver or
// a walker in the void got a chain of boxes: no centreline, no verge banding, no bend, no boards —
// on the one stretch of the world where the road IS the content.
//
// ⚠ AND THE OBVIOUS FIX IS THE WRONG ONE. Shipping the cells alongside the node payload cannot work
// (getMinimapData returns a flat array, and non-index properties do not survive JSON), and adding a
// sibling field to that message means editing **24 senders** — movement.js, world.js, routes.js,
// index.js, and the commerce, dev-tools, elevator and flashlight plugins. Twenty-four chances to
// miss one, and the miss reads as "the sidebar map randomly forgets the highway".
//
// So this rides its own packet instead. It costs the engine nothing, touches no existing sender,
// and — the part that actually matters — it serves the cells from the SAME provider the cab GPS
// uses, so the two surfaces agree about the road for the same reason rather than by coincidence.
//
// ⚠ CLEARING IT IS THE BUG, NOT DRAWING IT. A stale window left behind after you walk off the
// corridor is a sidebar showing a highway that is not there, and that reads as a render fault
// rather than the state fault it is. So `pushRoadWindow` sends on the TRANSITION in both
// directions — a null road is a message, not a silence — and `_sentRoad` on the live player is the
// one-shot that keeps it from repeating. It lives on the player rather than in a Map here so it
// goes away when they do and cannot leak.
import { sendToPlayer } from '../../server/engine/messaging.js';
import { mapWindow } from '../flight/state.js';
import { crossingChain, crossingInfo } from '../voidwalking/index.js';
import { corridorPos, sOfNode } from './corridor.js';
import { rigOf, providerFor, routeForCrossing } from './state.js';

// Smaller than the cab's window on purpose. The sidebar tile is small and square, so what it can
// usefully show is the near field and the bend you are in — not the full look-ahead a windscreen
// has room for. The same call the cab GPS makes when it zooms its own map in.
export const MMROAD_RADIUS = 11;

// Who is on a road, and where on it. Two ways in, because a crossing is drivable AND walkable: the
// rig knows its own position on the corridor, and a walker has only the room they are standing in —
// but the road is deterministic (same crossing, same seed, same geometry), so the room index is
// enough to put them on it. That second path is the case that made this worth building: park the
// truck out there and climb down, and the cab panel is gone, so the sidebar is the only map left.
export function roadWindowFor(player) {
  if (!player) return null;
  const rig = rigOf(player);
  if (rig?.leg === 'corridor' && rig.route) {
    return shape(rig.route, rig.x, rig.y, rig.heading, providerFor(rig));
  }
  const live = player._crossing;
  if (!live?.instanceId) return null;
  const info = crossingInfo(live.instanceId);
  const destKey = live.destKey || info?.dests?.[0]?.key;
  if (!destKey) return null;
  const chain = crossingChain(live.instanceId, destKey) || [];
  const at = chain.indexOf(player.current_zone);
  if (at < 0) return null;                       // in the void, but not on this road
  const route = routeForCrossing(live.instanceId, destKey, chain.length);
  if (!route) return null;
  const pos = corridorPos(route, sOfNode(route, at), 0);
  if (!pos) return null;
  return shape(route, pos.x, pos.y, pos.heading,
    providerFor({ leg: 'corridor', route, instanceId: live.instanceId, window: info?.window }));
}

function shape(route, x, y, heading, at) {
  const cx = Math.round(x), cy = Math.round(y);
  return {
    cells: mapWindow({ grid_x: cx, grid_y: cy }, MMROAD_RADIUS, at),
    x: cx, y: cy,
    // Sub-tile lead alongside the heading, so the arrow sits where you actually are instead of
    // snapping to the middle of a tile — the same pair the cab GPS reads for its own arrow.
    ox: +(x - cx).toFixed(3), oy: +(y - cy).toFixed(3),
    heading: Math.round(heading),
  };
}

// One packet. Returns the road it sent (or null), so a caller can tell a transition from a no-op.
export function pushRoadWindow(player) {
  if (!player?.id) return null;
  const road = roadWindowFor(player);
  if (!road && !player._sentRoad) return null;   // nothing to say, and nothing to take back
  player._sentRoad = !!road;
  sendToPlayer(player.id, { type: 'mmroad', road: road || null });
  return road;
}
