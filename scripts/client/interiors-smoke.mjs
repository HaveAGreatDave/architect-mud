// interiors:smoke: ROOM's rooms standing in GLASS's world (docs/proposals/one-world-interiors.md).
// A room is placed by room-view.js roomToGlass, picked by distance by glass/interiors-near.js and drawn by
// gl/interiors.js inside GLASS 2's frame. This holds the placement to the window view's own sums (the two can't
// disagree, or the walls stand somewhere the eye isn't), the picking to its rules, and every hop of the wiring.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0, bad = 0;
const check = (name, ok, why = '') => { n++; if (!ok) { bad++; console.log(`  ✗ ${name}${why ? ' — ' + why : ''}`); } };
const imp = (f) => import(pathToFileURL(join(ROOT, f)).href);
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const { roomToGlass, roomOrigin, eyeBase, viewOf } = await imp('client/game/js/panels/room-view.js');
const { roomLayout } = await imp('client/shared/room-layout.js');
const { pickInteriors, roomBounds, interiorsFrame, INTERIOR_TUNE } = await imp('client/game/js/panels/glass/interiors-near.js');
const { m2t } = await imp('client/shared/world-scale.js');

const apply = (M, p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// ── placement: the matrix puts a point where the window view puts its eye ────────────────────────────────
const land = { kind: 'land', bt: 'office' }, map = [[land, land, land], [land, land, land], [land, land, land]];
for (const [bearing, side, face, entry, floor] of [[0, 180, 0, [0, 0], 0], [90, 180, 30, [2.5, -4], 3.2], [225, 90, 120, [-1, 6], 10.8]]) {
  const frame = { entry, side, floor, face: bearing };
  const base = eyeBase({ map, gx: 0, gy: 0, bearing, frame }, () => 3);
  const L = roomLayout({ w: 4.2, d: 5.5, h: 2.6, face });
  const M = roomToGlass(L, roomOrigin(frame, bearing), bearing, floor);
  for (const [u, v] of [[0, 0.2], [1.1, 2], [-1.5, 4]]) {
    const view = viewOf({ map, gx: 0, gy: 0, bearing, sky: {} }, base, { hour: 12, look: { at: [u, v], room: [L.w, L.d] }, k: 1 });
    const p = apply(M, L.world(u, v, 1.6));
    // the window's eye is kept on its own tile (viewOf `keep`); past the edge the room still stands where it is
    if (Math.abs(view.freeCam.x) > 0.489 || Math.abs(view.freeCam.y) > 0.489) continue;
    check(`bearing ${bearing}: [${u}, ${v}] stands where the window's eye does`, near(p[0], view.freeCam.x) && near(p[1], view.freeCam.y),
      `matrix ${p[0].toFixed(4)},${p[1].toFixed(4)} eye ${view.freeCam.x.toFixed(4)},${view.freeCam.y.toFixed(4)}`);
    check(`bearing ${bearing}: [${u}, ${v}] is at its height in tiles`, near(p[2], m2t(floor + 1.6)), String(p[2]));
  }
  check(`bearing ${bearing}: the origin is inBuilding's`, near(roomOrigin(frame, bearing)[0], base.x) && near(roomOrigin(frame, bearing)[1], base.y));
}
// a street door in a side or back wall (frame.door): the DOOR is stood on the street edge, not the front wall, and the
// room runs back into the building from it. The Embassy's lobby faces north with its door in the west wall; the Cherry
// Pit faces west with its door in its back wall, on the east street.
for (const [name, front, side, w, d, door] of [['a west door in the left wall', 0, 270, 14, 10, [-7, 5]], ['an east door in the back wall', 270, 90, 11, 14, [0, 14]], ['a south door mid-front', 180, 180, 14, 10, [0, 0]]]) {
  const frame = { entry: [0, 0], front, side, floor: 0, face: front, door };
  const L = roomLayout({ w, d, h: 4, face: front }), M = roomToGlass(L, roomOrigin(frame, front), front, 0);
  const at = apply(M, L.world(door[0], door[1], 0)), s = side * Math.PI / 180, edge = [Math.sin(s) * 0.47, -Math.cos(s) * 0.47];
  check(`${name}: the door is on the street edge`, near(at[0], edge[0]) && near(at[1], edge[1]), `door at ${at[0].toFixed(3)},${at[1].toFixed(3)}`);
  const mid = apply(M, L.world(0, d / 2, 0));
  check(`${name}: the room is behind it, in the building`, Math.hypot(mid[0], mid[1]) < Math.hypot(edge[0], edge[1]), `middle at ${mid[0].toFixed(3)},${mid[1].toFixed(3)}`);
}
// a room facing north: its back wall is south of its front (+y south), its right is east
{
  const L = roomLayout({ w: 4, d: 6, h: 2.6, face: 0 }), M = roomToGlass(L, [0, 0], 0, 0);
  const front = apply(M, L.world(0, 0, 0)), back = apply(M, L.world(0, 6, 0)), right = apply(M, L.world(2, 0, 0));
  check('facing north, the room runs back to the south', back[1] > front[1] && near(back[0], front[0]));
  check('facing north, its right is east', right[0] > front[0] && near(right[1], front[1]));
  check('the floor is z 0 and up is +z', near(front[2], 0) && apply(M, L.world(0, 0, 2.6))[2] > 0);
}

// ── picking: whole near, a box further off, nothing past that ────────────────────────────────────────────
{
  const room = (key, x) => ({ key, gx: 0, gy: 0, M: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], box: [x, 0, x + 0.2, 0.2, 0, 0.15], parts: () => [] });
  const rooms = [room('in', 0), room('near', 0.5), room('mid', 2), room('far', 9)];
  const p = pickInteriors(rooms, [0.1, 0.1, 0.1]);
  const lod = Object.fromEntries(p.map((x) => [x.room.key, x.lod]));
  check('the room you stand in is whole', lod.in === 0 && p[0].room.key === 'in' && p[0].dist === 0);
  check('a room next door is whole', lod.near === 0);
  check('a room a couple of tiles off is a box', lod.mid === 1);
  check('a room far off isn\'t loaded at all', !('far' in lod));
  const many = Array.from({ length: 20 }, (_, i) => room('r' + i, i * 0.01));
  const q = pickInteriors(many, [0, 0, 0]);
  check('no more whole rooms than maxNear', q.filter((x) => x.lod === 0).length === INTERIOR_TUNE.maxNear);
  const f = interiorsFrame(p, -3, 2);
  check('a frame entry is keyed by its level', f.some((x) => x.key === 'mid#box') && f.some((x) => x.key === 'in#mesh'));
  check('a frame entry is moved to the map window', near(f[0].M[12], 3) && near(f[0].M[13], -2));
  // a whole room whose mesh is still building in the worker (room-interiors.js meshReady) is its box meanwhile
  const wait = interiorsFrame(p.map((x) => (x.room.key === 'in' ? { ...x, room: { ...x.room, meshReady: () => false } } : x)), -3, 2);
  check('a room still building is drawn as its box', wait.some((x) => x.key === 'in#box' && x.lod === 1) && !wait.some((x) => x.key === 'in#mesh'));
  const L = roomLayout({ w: 4, d: 6, h: 2.6 }), b = roomBounds(L, roomToGlass(L, [0, 0], 0, 0), 10, 20);
  check('a room\'s bounds are in absolute tiles', b[0] < 10 && b[2] > 10 && b[1] >= 20 - 1e-9 && b[3] > 20 && near(b[4], 0));
}

// ── wiring: every hop from the view to the layer ─────────────────────────────────────────────────────────
const ws = read('client/game/js/panels/windshield.js'), inst = read('client/game/js/panels/gl/install.js');
const world = read('client/game/js/panels/gl/world.js'), ctx = read('client/game/js/panels/gl/context.js');
check('the frame hands its rooms to the GL hook', /interiors: interiorUpload\(v, cam\)/.test(ws));
check('install passes them on', /interiors: opts\.interiors/.test(inst));
check('the world pass draws them', /g\.view\.drawInteriors\(cam, opts\.interiors/.test(world));
check('the GL view has the layer', /function drawInteriors/.test(ctx) && /drawStrokes, drawInteriors,/.test(ctx));
// on foot: the server sends a building's rooms once, the street view keeps and draws them, and walks in
const fl = read('plugins/freelook/index.js'), rs = read('plugins/roomstage/index.js'), fv = read('client/game/js/panels/freelook-view.js');
const disp = read('client/game/js/dispatch.js'), lazy = read('client/game/js/panels/lazy-views.js');
check('the street window carries the rooms near you', /\.\.\.interiorsFor\(gx, gy, pid\)/.test(fl) && /export function buildingRoomsNear/.test(rs));
check('each building\'s rooms go to a player once', /roomsSent/.test(fl) && (fl.match(/roomsSent\.delete\(player\.id\)/g) || []).length >= 2);
check('the street view keeps them and hands them to the frame', /keepInteriors\(s, ctx\.interiors\)/.test(fv) && /interiorRooms: st\.foot/.test(fv));
check('a room the street view drew is walked into in GLASS', /if \(freelookTakeRoom\(msg\)\) return;/.test(disp) && /freelookTakeRoom = ifLoaded/.test(lazy));
check('indoors, the server\'s close doesn\'t park the view', /msg\?\.indoors && freelookInside\(\)/.test(disp));
check('inside, the room\'s own floor holds you', /if \(s\.inside\) return insideBlock/.test(fv) && /roomFree\(r\.L/.test(fv));
check('one world is off until it\'s turned on', /export const ONE_WORLD = \{ on: false \}/.test(fv));

console.log(bad ? `interiors:smoke — ${bad} of ${n} failed` : `interiors:smoke — ${n} checks passed`);
process.exit(bad ? 1 : 0);
