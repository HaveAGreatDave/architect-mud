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
import { roomBounds, roomPanes } from './glass/interiors-near.js';
import { createBatch, vtx } from './gl/ballpark-mesh.js';
import { TILE_M } from '../../../shared/world-scale.js';
// A ROOM ON A VESSEL (plugins/roomstage buildingRoomsNear, `frame.vessel`), put on her hull as she sits now: `x`, `y`
// her middle in tiles off the room's tile (her `sub` as she sails), `heading` her bow's compass bearing, `ride` her
// heave in world-z tiles and her pitch and roll in degrees (windshield.js seaRideAt, the call her hull is drawn with).
// Her rooms rise and fall with her heave, all together, and don't tilt: the walk reads a matrix flat (roomUV), and two
// rooms of one deck must stand at one height or a doorway between them is a change of storey (interiors-near.js
// sameStorey). Her pitch and roll are the hull's to show. Sets the room's matrix, box and panes in place.
const D2R = Math.PI / 180;
export function placeOnVessel(room, { x = 0, y = 0, heading = 0, ride = null } = {}) {
  const V = room.vessel, h = heading * D2R, sh = Math.sin(h), ch = Math.cos(h);
  const fw = V.fz / TILE_M, st = V.sx / TILE_M;
  const origin = [x + fw * sh + st * ch, y - fw * ch + st * sh];
  const lift = ride ? ride.heave : 0;
  room.M = roomToGlass(room.L, origin, heading + V.face, (Number(V.deck) || 0) + V.floor + lift * TILE_M);
  room.bearing = heading + V.face;
  room.box = roomBounds(room.L, room.M, room.gx, room.gy);
  room.panes = roomPanes(room.L.spec, room.L, room.M);
  return room;
}
// A room's openings onto a rink (`kind: 'open'` panes, which the mesh leaves as holes: gl/room-mesh.js), as two triangles
// each in the room's frame, for the ice to be painted into (freelook-view.js owRinkTick). Null with none.
export function openHoles(L) {
  const S = L?.spec, W = S?.w || 4, D = S?.d || 4, ps = (S?.windows || []).filter((q) => q.kind === 'open');
  if (!ps.length) return null;
  const b = createBatch(ps.length * 6), n = [0, 1, 0], uv = [0, 0], col = [1, 1, 1];
  for (const q of ps) {
    const y0 = q.y0 ?? 0, y1 = q.y1 ?? (S.h || 2.6);
    const at = (t) => (q.wall === 'front' ? [t, 0] : q.wall === 'back' ? [t, D] : q.wall === 'left' ? [-W / 2, t] : [W / 2, t]);
    const A = at(q.a), B = at(q.b), c = [L.world(A[0], A[1], y0), L.world(B[0], B[1], y0), L.world(B[0], B[1], y1), L.world(A[0], A[1], y1)];
    for (const i of [0, 1, 2, 0, 2, 3]) vtx(b, c[i], n, uv, col, 0);
  }
  return b;
}

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
const MESH_FIELDS = ['solid', 'screen', 'textured', 'lamps', 'screens'];
// and a clone vat hall's (gl/room-decor.js `vat` and `gantry`): its glass, its vats and its gantries, for the vats' fluid,
// machines and sleepers drawn in GLASS as on the Stage (gl/interiors.js, one-world phase F)
const VAT_FIELDS = [...MESH_FIELDS, 'glass', 'vats', 'gantries'];
// and a room with no shell's (spec.void, gl/room-mesh.js voidRoom): what gl/room-void.js draws round it
const VOID_FIELDS = [...MESH_FIELDS, 'voidRoom'];
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
// `lampOn(zone)` says whether a room's lights are on, and `lampLevel(zone)` (0.1 to 1) how far up its dimmer is; the
// lamp's light is scaled by it and its mesh isn't, as on the Stage, where dimming needs no rebuild. Returns the rooms for a view's `interiorRooms`.
// `shift` ([x, y] tiles) moves every room of the building by the same amount: the street view on foot hands it the
// distance from where the plan puts the street door (the middle of the tile's street edge) to where the model's
// doorway really is (glass/doorway-measure.js), so the lobby is behind the door and not beside it.
const LAMP_RGB = [0.32, 0.24, 0.14];
// `was` (key -> the entry it replaces) keeps a rebuilt room drawn with its old mesh till the new one is built, so a piece
// moved doesn't drop the room to a box for a moment.
export function interiorRoomsOf(data, { lampOn = () => true, lampLevel = () => 1, itemOf, shift = null, was = null } = {}) {
  if (!data?.rooms?.length || !data.tile) return [];
  const all = new Set(data.rooms.map((r) => r.zone)), out = [];
  for (const r of data.rooms) {
    // a vessel's room is placed on her hull each frame (placeOnVessel); here, as she'd sit pointing north on her tile
    const V = r.frame?.vessel || null;
    const bearing = V ? V.face : r.frame?.face ?? 0, at = V ? [0, 0] : roomOrigin(r.frame, bearing, Number(r.spec?.d) || 0, { near: true });
    if (!at) continue;
    const origin = shift && !V ? [at[0] + shift[0], at[1] + shift[1]] : at;
    // the server lays a room out itself (plugins/roomstage buildingRoomsNear); the Modelshop sends the rows
    const pieces = r.pieces || layRows(r.rows || [], r.spec, { finish: r.spec.finish, ...(itemOf ? { itemOf } : {}) }).pieces;
    const L = roomLayout(r.spec, pieces), M = roomToGlass(L, origin, bearing, Number(r.frame.floor) || 0);
    const seed = hashOf(r.zone), on = !!lampOn(r.zone), bk = (r.key || r.zone) + '|' + (on ? 1 : 0) + '|' + seed + (r.ver ? '|v' + r.ver : '');
    const old = was?.get(r.key || r.zone)?.baseKey?.() || null;
    // `doorsIn`: the street's glass doors stay in the room's batches, drawn shut. GLASS moves nothing in them, and
    // lifted out (as the Stage lifts them, to move them) nobody drew them: a doorway with no door in it
    const opts = { seed, lampOn: on, joined: all, doorsIn: true }, vatRoom = (L.placed || []).some((p) => p.form === 'vat');
    const fields = vatRoom ? VAT_FIELDS : r.spec?.void ? VOID_FIELDS : MESH_FIELDS;
    // a mesh asked of the worker once: `k` its key in the cache, `ps` the pieces it's built from
    const want = (k, ps, o = opts) => {
      if (built.has(k) || !workerUp() || waiting.has(k)) return;
      waiting.add(k);
      ask({ spec: r.spec, pieces: ps, opts: o, fields })
        .then(async (m) => { if (m) await Promise.all([...m.textured.keys()].map((t) => tintAhead(t, seed))); keep(k, m || null); })
        .catch((e) => { console.warn('[interiors] a room would not build off the thread:', r.zone, e?.message); keep(k, null); })
        .finally(() => waiting.delete(k));
    };
    // PIECES LEFT OUT while the kitchen draws its own of them (the fridge it opens, the microwave it cooks in; freelook-
    // view.js's kitchen host `hide`, as room-stage.js's). Its mesh is built beside the room's, and the room keeps the
    // whole one till it's ready, so nothing goes to a box meanwhile.
    let hid = null, over = null, overN = 0;
    const cur = () => (hid && built.has(hid.bk) ? hid.bk : !built.has(bk) && old && old !== bk && built.has(old) ? old : bk);
    out.push({
      // a lift car comes once for each landing it stops at (plugins/roomstage buildingRoomsNear): `key` the car and the
      // landing, `stop` the landing, so each copy is its own room here, its mesh kept apart (bk) since its doors differ
      key: r.key || r.zone, zone: r.zone, stop: r.stop || null, gx: data.tile.x, gy: data.tile.y, M, L, bearing, vessel: V,
      // a place's room (plugins/roomstage placeRooms, docs/proposals/the-inbetween.md): laid out as a vessel's, on its own
      // patch of empty ground, and never moved after (freelook-view.js owVesselTick leaves it alone)
      place: !!data.place,
      box: roomBounds(L, M, data.tile.x, data.tile.y),
      panes: roomPanes(r.spec, L, M),
      // a room's own dimmer (flags.room.dim: a cell lit by its high windows, a vat hall by its vats) as the Stage has it
      dayK: Number.isFinite(r.spec?.daylight) ? r.spec.daylight : 1,
      lamp: on && !r.spec?.unlit ? LAMP_RGB.map((c) => c * Math.max(0.1, Math.min(1, Number(lampLevel(r.zone)) || 1)) * (Number(r.spec?.dim) || 1)) : null,
      // whether its whole mesh can be had this frame; if not, it's asked for and the room stays a box meanwhile
      meshReady() {
        if (over) return true;
        if (hid) want(hid.bk, hid.pieces, hid.opts);
        if (built.has(bk) || (cur() !== bk && built.has(cur()))) { if (!built.has(bk)) want(bk, pieces); return true; }
        if (!workerUp()) return true;
        want(bk, pieces);
        return false;
      },
      seed,
      // its openings onto a rink (openHoles), worked out the first time they're asked for
      holes() { if (this._holes === undefined) this._holes = openHoles(L); return this._holes; },
      // leave these pieces' ids out of the mesh (none: put them all back); `meshTag` keys the layer's copy by it
      // `busy`: a MORPHEX pod's id, drawn without its open halves while its sequence swings its own (gl/room-mesh.js busy)
      hideMesh(ids, busy = null) {
        const set = new Set((ids || []).map(String));
        if (!set.size && busy == null) { hid = null; return; }
        const key = [...set].sort().join(',') + (busy != null ? '+busy:' + busy : '');
        if (hid?.key === key) return;
        const ps = pieces.filter((p) => !set.has(String(p.id))), o = busy != null ? { ...opts, busy } : opts;
        hid = { key, bk: bk + '|hide:' + key, pieces: ps, opts: o };
        if (!workerUp() && !built.has(hid.bk)) keep(hid.bk, buildRoom(roomLayout(r.spec, ps), o));
        else want(hid.bk, ps, o);
      },
      // a mesh the host built itself, drawn instead of the room's own till it's taken off (null): the arrange mode's
      // room with its walls down (freelook-view.js owArrangeStart). Each one set is its own copy in the layer.
      override(m) { over = m || null; if (over) overN++; },
      meshTag: () => { if (over) return '|arr:' + overN; const k = cur(); return k === bk ? '' : hid && k === hid.bk ? '|hide:' + hid.key : '|was:' + k; },
      baseKey: () => (built.has(bk) ? bk : cur()),
      // its lamps once its whole mesh is built ({ p, k } in the room's frame, gl/room-mesh.js), lit or not; none in the
      // en-suite, which the layer doesn't light
      lampsNow: () => (on ? (built.get(cur())?.lamps || []).filter((l) => !l.annex) : []),
      // its sets' screens ({ id, quad } in the room's frame, gl/room-mesh.js), for a pointer on the picture
      screensNow: () => built.get(cur())?.screens || [],
      // a vat hall's vats and gantries in the room's frame, once its whole mesh is built (null in any other room)
      vatsNow: () => (vatRoom ? built.get(cur())?.vats || null : null),
      gantriesNow: () => (vatRoom ? built.get(cur())?.gantries || [] : []),
      // a room with no shell (spec.void): what gl/room-void.js draws round it, in the room's frame, once its mesh is built
      voidNow: r.spec?.void ? () => built.get(cur())?.voidRoom || null : null,
      // the room as seen from its street door, if it has one and there's a picture of it (lobby-still.js)
      still: () => bakedStill(r.zone),
      parts(lod) {
        if (lod) return [{ batch: roomBox(L, linearHex(r.spec.tone?.wall) || undefined) }];
        if (over) return [{ batch: over.solid }, { batch: over.screen, screen: true }, ...[...over.textured].map(([key, b]) => ({ batch: b, tint: tintOf(key, seed) }))];
        const k = cur();
        let m = built.get(k);
        if (!m) keep(k, (m = buildRoom(k === bk ? L : hid && k === hid.bk ? roomLayout(r.spec, hid.pieces) : L, hid && k === hid.bk ? hid.opts : opts)));
        // a vat hall's glass is drawn after the fluid (`glass`), less each vat's own static fill while the fluid layer runs (`cut`)
        const glass = vatRoom && m.glass?.n ? [{ batch: m.glass, glass: true, cut: (m.vats || []).map((v) => v.glass).filter((g) => g && g[1] > 0) }] : [];
        return [{ batch: m.solid }, { batch: m.screen, screen: true }, ...[...m.textured].map(([key, b]) => ({ batch: b, tint: tintOf(key, seed) })), ...glass];
      },
    });
    if (V) placeOnVessel(out[out.length - 1]);
  }
  return out;
}
