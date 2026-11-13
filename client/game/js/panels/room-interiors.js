// A BUILDING'S ROOMS, READY TO STAND IN GLASS'S WORLD (docs/proposals/one-world-interiors.md).
//
// Takes every room of a building as the roomstage plugin plans it (its spec, its furniture rows and its `frame`,
// the same frame the window view is placed by) and turns each into what glass/interiors-near.js picks from:
// where it stands (room-view.js roomToGlass), the box it takes up, and how to build either level of it. Nothing is
// built here: `parts(lod)` builds a room the first frame the layer wants it, and only then.
import { roomLayout, layRows } from '../../../shared/room-layout.js';
import { buildRoom, paintRoomTexture, ROOM_RUG } from './gl/room-mesh.js';
import { roomBox, meanColour, linearHex } from './gl/interiors.js';
import { bakedStill } from './lobby-still.js';
import { roomToGlass, roomOrigin } from './room-view.js';
import { roomBounds } from './glass/interiors-near.js';

const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const tints = new Map();
const tintOf = (key, seed) => {
  const k = key === ROOM_RUG ? key + seed : key;
  if (!tints.has(k)) tints.set(k, meanColour(paintRoomTexture(document, key, key === ROOM_RUG ? seed : 1)));
  return tints.get(k);
};

// ⚠ A WHOLE ROOM IS BUILT IN A WORKER (room-mesh-worker.js, the one the Room Stage bakes ahead in). buildRoom is 40 to
// 60 ms warm and 160 to 240 ms cold, and a material's picture 5 to 35 ms more; on foot gl/interiors.js asked for one
// room a frame as you came near a building, so walking past one with a few Stage rooms was a run of long frames.
// Until a room's mesh is back it's drawn as its lit box (`meshReady`, glass/interiors-near.js interiorsFrame). With no
// worker (Node, the gates, a GLASS painted inside a worker) it's built on the spot, as before.
// The meshes are kept here by room and lamp, not on the room: the room objects are made again from every push.
const MESH_FIELDS = ['solid', 'screen', 'textured'];
const built = new Map();      // zone|lamp|seed -> mesh, or null once the worker couldn't (built on the page then)
const BUILT_KEEP = 32;
let worker = null, asked = 0;
const waits = new Map();
function workerUp() {
  if (worker === false) return false;
  if (worker) return true;
  try {
    if (typeof Worker !== 'function' || typeof document === 'undefined') { worker = false; return false; }
    worker = new Worker(new URL('./room-mesh-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: { id, mesh, bitmap, error } }) => { const w = waits.get(id); if (w) { waits.delete(id); if (error) console.warn('[interiors] off the thread:', error); w(error ? null : mesh || bitmap); } };
    worker.onerror = (e) => { console.warn('[interiors] mesh worker off, building on the page:', e?.message); worker.terminate(); worker = false; for (const w of waits.values()) w(null); waits.clear(); };
    return true;
  } catch { worker = false; return false; }
}
const ask = (msg) => new Promise((done) => { const id = ++asked; waits.set(id, done); worker.postMessage({ id, ...msg }); });
// a material's mean colour, its picture painted in the worker (a sign's lettering may be in a font only the page has)
const tintKey = (key, seed) => (key === ROOM_RUG ? key + seed : key);
async function tintAhead(key, seed) {
  const k = tintKey(key, seed);
  if (tints.has(k)) return;
  const s = key === ROOM_RUG ? seed : 1;
  const bmp = key.startsWith('roomSign|') || typeof OffscreenCanvas !== 'function' ? null : await ask({ texture: key, seed: s });
  if (!tints.has(k)) tints.set(k, meanColour(bmp || paintRoomTexture(document, key, s)));
  bmp?.close?.();
}
const waiting = new Set();
const keep = (k, m) => { built.delete(k); built.set(k, m); if (built.size > BUILT_KEEP) built.delete(built.keys().next().value); };

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
    const seed = hashOf(r.zone), on = !!lampOn(r.zone), bk = r.zone + '|' + (on ? 1 : 0) + '|' + seed;
    const opts = { seed, lampOn: on, joined: all };
    out.push({
      key: r.zone, zone: r.zone, gx: data.tile.x, gy: data.tile.y, M, L,
      box: roomBounds(L, M, data.tile.x, data.tile.y),
      lamp: on ? [0.32, 0.24, 0.14] : null,
      // whether its whole mesh can be had this frame; if not, it's asked for and the room stays a box meanwhile
      meshReady() {
        if (built.has(bk)) return true;
        if (!workerUp()) return true;
        if (waiting.has(bk)) return false;
        waiting.add(bk);
        ask({ spec: r.spec, pieces, opts, fields: MESH_FIELDS })
          .then(async (m) => { if (m) await Promise.all([...m.textured.keys()].map((k) => tintAhead(k, seed))); keep(bk, m || null); })
          .catch((e) => { console.warn('[interiors] a room would not build off the thread:', r.zone, e?.message); keep(bk, null); })
          .finally(() => waiting.delete(bk));
        return false;
      },
      // the room as seen from its street door, if it has one and there's a picture of it (lobby-still.js)
      still: () => bakedStill(r.zone),
      parts(lod) {
        if (lod) return [{ batch: roomBox(L, linearHex(r.spec.tone?.wall) || undefined) }];
        let m = built.get(bk);
        if (!m) keep(bk, (m = buildRoom(L, opts)));
        return [{ batch: m.solid }, { batch: m.screen }, ...[...m.textured].map(([key, b]) => ({ batch: b, tint: tintOf(key, seed) }))];
      },
    });
  }
  return out;
}
