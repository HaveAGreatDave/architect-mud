// A BUILDING'S ROOMS, READY TO STAND IN GLASS'S WORLD (docs/proposals/one-world-interiors.md).
//
// Takes every room of a building as the roomstage plugin plans it (its spec, its furniture rows and its `frame`,
// the same frame the window view is placed by) and turns each into what glass/interiors-near.js picks from:
// where it stands (room-view.js roomToGlass), the box it takes up, and how to build either level of it. Nothing is
// built here: `parts(lod)` builds a room the first frame the layer wants it, and only then.
import { roomLayout, layRows } from '../../../shared/room-layout.js';
import { buildRoom, paintRoomTexture, ROOM_RUG } from './gl/room-mesh.js';
import { roomBox, meanColour } from './gl/interiors.js';
import { roomToGlass, roomOrigin } from './room-view.js';
import { roomBounds } from './glass/interiors-near.js';

const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const tints = new Map();
const tintOf = (key, seed) => {
  const k = key === ROOM_RUG ? key + seed : key;
  if (!tints.has(k)) tints.set(k, meanColour(paintRoomTexture(document, key, key === ROOM_RUG ? seed : 1)));
  return tints.get(k);
};

// `data` is /api/building-rooms (or the plugin's equivalent): { tile: { x, y }, rooms: [{ zone, spec, rows or pieces, frame }] }.
// `lampOn(zone)` says whether a room's lights are on. Returns the rooms for a view's `interiorRooms`.
export function interiorRoomsOf(data, { lampOn = () => true, itemOf } = {}) {
  if (!data?.rooms?.length || !data.tile) return [];
  const all = new Set(data.rooms.map((r) => r.zone)), out = [];
  for (const r of data.rooms) {
    const bearing = r.frame?.face ?? 0, origin = roomOrigin(r.frame, bearing);
    if (!origin) continue;
    // the server lays a room out itself (plugins/roomstage buildingRoomsNear); the Modelshop sends the rows
    const pieces = r.pieces || layRows(r.rows || [], r.spec, { finish: r.spec.finish, ...(itemOf ? { itemOf } : {}) }).pieces;
    const L = roomLayout(r.spec, pieces), M = roomToGlass(L, origin, bearing, Number(r.frame.floor) || 0);
    const seed = hashOf(r.zone), on = !!lampOn(r.zone);
    out.push({
      key: r.zone, zone: r.zone, gx: data.tile.x, gy: data.tile.y, M, L,
      box: roomBounds(L, M, data.tile.x, data.tile.y),
      lamp: on ? [0.32, 0.24, 0.14] : null,
      parts(lod) {
        if (lod) return [{ batch: roomBox(L) }];
        const m = buildRoom(L, { seed, lampOn: on, joined: all });
        return [{ batch: m.solid }, { batch: m.screen }, ...[...m.textured].map(([key, b]) => ({ batch: b, tint: tintOf(key, seed) }))];
      },
    });
  }
  return out;
}
