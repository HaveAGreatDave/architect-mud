// ROOM · THE VEHICLE STAND GATE (client/game/js/panels/room-hoist.js; docs/reference/depot-shell.md, "Call it up").
//
// Each of the four kinds is called up in a made-up depot room with its own stand, under the DOM stub, and:
//   1. its spec comes through roomSpecOf with the stand kept inside the room, and the rules keep furniture off it
//   2. on the way in it is drawn, and on the floor it is drawn inside the room, under the ceiling
//   3. out on the floor it stands inside its box (a lift's truck where the shed always put it)
//   4. it blocks the walker once it's out, and a slip of water blocks the walker whether or not a boat is in it
//   5. beside it the key that seats you comes up, with the verb the server sent; across the room it doesn't
//   6. sent back, the floor is empty again and nothing blocks the walker but the water
//
//   node scripts/shapes/room-stand.mjs
import './dom-stub.mjs';
import { roomLayout, roomSpecOf, placeSpot } from '../../client/shared/room-layout.js';
import { createBatch, STRIDE } from '../../client/game/js/panels/gl/ballpark-mesh.js';
import { DEPOT_SHED } from '../../client/shared/depot-shed.js';
import { buildRoom } from '../../client/game/js/panels/gl/room-mesh.js';

const { loadAircraft3d } = await import('../../client/game/js/panels/aircraft3d-lazy.js');
await loadAircraft3d();
const { createRoomHoist } = await import('../../client/game/js/panels/room-hoist.js');

let fails = 0, checks = 0;
const check = (name, ok, info = '') => { checks++; if (!ok) { fails++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); } };

// performance.now is the stand's clock; the gate steps it by hand
let NOW = 1000;
globalThis.performance = { now: () => NOW };

const host = { children: [], append(...els) { this.children.push(...els); } };
const btn = () => host.children.find((e) => e.className === 'rh-board');

const ROOMS = [
  { kind: 'truck', room: { w: 16, d: 24, h: 7.5, studio: false, windowless: true }, look: { cls: 'truck', variant: 'hauler' }, board: 'drive t1' },
  // a depot's shed is GLASS's (gl/room-depot.js): its size and its lift are the bake's, whatever the room says
  { kind: 'truck', name: 'truck shed', room: { w: 16, d: 24, h: 7.5, bay: 'truck' }, look: { cls: 'truck', variant: 'hauler' }, board: 'drive t1' },
  { kind: 'aircraft', room: { w: 30, d: 30, h: 8, studio: false, windowless: true, stand: { kind: 'aircraft', at: [0, 15], face: 'front', len: 18, wid: 20, from: 'back' } },
    look: { cls: 'prop', livery: {} }, board: 'hangaract launch a1' },
  // a hangar's floor lift: the deck parts, the turntable comes up turning (room-hoist.js drawCarousel)
  { kind: 'aircraft', name: 'aircraft carousel', carousel: true, room: { w: 30, d: 30, h: 12, studio: false, windowless: true, stand: { kind: 'aircraft', at: [0, 15], face: 'front', len: 18, wid: 20, from: 'below', kiosk: { at: [13, 3], face: 'left' } } },
    look: { cls: 'prop', livery: {} }, board: 'hangaract launch a1' },
  { kind: 'boat', room: { w: 18, d: 22, h: 7, studio: false, windowless: true, stand: { kind: 'boat', at: [-3, 9], face: 'back', len: 13, wid: 5, from: 'front', water: true } },
    look: { cls: 'hydro', livery: null }, board: 'boat take b1' },
  { kind: 'podracer', room: { w: 16, d: 20, h: 6, studio: false, windowless: true, stand: { kind: 'podracer', at: [0, 11], face: 'front', len: 11, wid: 6, from: 'back' } },
    look: { cls: 'podracer', variant: 'podracer', livery: null, kit: null }, board: 'podracer take p1' },
];

for (const R of ROOMS) {
  const name = R.name || R.kind;
  console.log(`· ${name}`);
  const spec = roomSpecOf({ room: R.room }, false);
  const S = spec.stand;
  if (R.room.bay) {
    const B = DEPOT_SHED, P = B.lift;
    check('shed: the room is the shed\'s size, whatever the room says', spec.w === B.w && spec.d === B.d && spec.h === B.eaves, `${spec.w} x ${spec.d} x ${spec.h}`);
    check('shed: the stand is the lift\'s plate, coming up from below', S?.from === 'below' && Math.abs(S.box[1] - S.box[0] - P.w) < 1e-6 && Math.abs(S.box[3] - S.box[2] - P.l) < 1e-6
      && Math.abs((S.box[2] + S.box[3]) / 2 - P.at[1]) < 1e-6, JSON.stringify(S));
    const Lb = roomLayout(spec, []);
    check('shed: the walker goes round its fittings', B.solids.every((q) => Lb.solid.some((s) => s[0] === q[0] && s[3] === q[3])), `${Lb.solid.length} boxes`);
    const m = buildRoom(Lb, {});
    check('shed: the mesh is the shed, lit by its own high-bays', m.solid.n > 3000 && m.lamps.length === B.lamps.length, `${m.solid.n} vertices, ${m.lamps.length} lamps`);
    // a doorway in a wall is a hole through the shed's steel: nothing of the shed's is drawn in it
    const door = { kind: 'front', wall: 'front', a: B.side.u0, b: B.side.u1, dir: 'south', to: 'z' };
    const Ld = roomLayout({ ...spec, openings: [door] }, []), md = buildRoom(Ld, {});
    const o = Ld.world(0, 0, 0), eu = Ld.world(1, 0, 0), ev = Ld.world(0, 1, 0);
    const uOf = (p) => { const a = [eu[0] - o[0], eu[2] - o[2]], c = [ev[0] - o[0], ev[2] - o[2]], q = [p[0] - o[0], p[2] - o[2]], det = a[0] * c[1] - a[1] * c[0];
      return [(q[0] * c[1] - q[1] * c[0]) / det, (a[0] * q[1] - a[1] * q[0]) / det]; };
    let inHole = 0;
    for (let i = 0; i < md.solid.n; i++) {
      const at = i * STRIDE, p = [md.solid.data[at], md.solid.data[at + 1], md.solid.data[at + 2]], [u, v] = uOf(p);
      if (u > door.a + 0.05 && u < door.b - 0.05 && v > 0.01 && v < 0.19 && p[1] > 0.1 && p[1] < 1.9) inHole++;
    }
    check('shed: the people-door is a hole in the front wall', inHole === 0, `${inHole} vertices in the doorway`);
  }
  if (S) {
    check(`${name}: the stand comes through the spec`, !!S && S.kind === R.kind && S.box.length === 4, JSON.stringify(S));
    check(`${name}: the stand's box is inside the room`, S.box[0] >= -spec.w / 2 - 1e-6 && S.box[1] <= spec.w / 2 + 1e-6 && S.box[2] >= -1e-6 && S.box[3] <= spec.d + 1e-6, JSON.stringify(S.box));
    // a crate laid out by the rules lands off the stand
    const spot = placeSpot(spec, [], 'container', [0.8, 0.6, 0.8], { form: 'crate' });
    // a spot against a wall stands its depth off it; out in the room it's `at`
    const wallAt = (s) => s.wall === 'back' ? [s.along, spec.d - 0.4] : s.wall === 'front' ? [s.along, 0.4] : s.wall === 'left' ? [-spec.w / 2 + 0.4, s.along] : [spec.w / 2 - 0.4, s.along];
    const at = spot?.at || (spot?.wall ? wallAt(spot) : null);
    check(`${name}: the rules find the crate a spot`, !!at, JSON.stringify(spot));
    if (at) check(`${name}: the rules keep a crate off the stand`, !(at[0] > S.box[0] && at[0] < S.box[1] && at[1] > S.box[2] && at[1] < S.box[3]), JSON.stringify(at));
  }
  const L = roomLayout(spec, []);
  let you = [L.spec.w / 2 - 0.6, 0.8];
  const sent = [];
  host.children.length = 0;
  const H = createRoomHoist({ host, send: (c) => sent.push(c), walker: () => you });
  H.load(L, { kind: R.kind, moveMs: 9000, from: S?.from || 'below', label: 'X', call: 'callup', back: 'callup back', lift: null, mine: [{ id: 'v1', name: 'One' }] });
  const solid0 = (L.solid || []).filter((q) => q._hoist).length;
  check(`${name}: an empty floor blocks nothing but water`, solid0 === (S?.water ? 1 : 0), `${solid0} boxes`);
  // called up: halfway through its move, then out
  NOW = 1000;
  H.load(null, { kind: R.kind, moveMs: 9000, from: S?.from || 'below', label: 'X', call: 'callup', back: 'callup back', mine: [],
    lift: { id: 'v1', name: 'One', look: R.look, mine: true, board: R.board, age: 0 } });
  await new Promise((ok) => setTimeout(ok, 10));   // the model loader's then
  if (R.carousel) {
    check(`${name}: the spec keeps the display's spot`, S.kiosk?.face === 'left' && S.kiosk.at[0] === 13, JSON.stringify(S.kiosk));
    // a tenth of the way: the leaves are drawing back and she's still down in the well, nothing of her above the floor
    NOW = 1000 + 900;
    const early = createBatch(1024);
    H.into(early, NOW);
    let above = 0;
    for (let i = 0; i < early.n; i++) if (early.data[i * STRIDE + 1] > 0.2) above++;
    check(`${name}: early on she's still under the floor`, above === 0 && early.n > 200, `${above} vertices above the floor of ${early.n}`);
    check(`${name}: the rim lamps chase while it moves`, (early.lights || []).length > 0 && early.lights.every((l) => l.c[0] === 1), JSON.stringify(early.lights?.[0]));
  }
  NOW = 1000 + 4500;
  const mid = createBatch(1024);
  H.into(mid, NOW);
  check(`${name}: on its way it's drawn`, mid.n > 30, `${mid.n} vertices`);
  NOW = 1000 + 9500;
  const out = createBatch(1024);
  H.into(out, NOW);
  // its own vertices: everything above the stand's edge, which is laid at a few centimetres
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], n = 0;
  const local = [];
  for (let i = 0; i < out.n; i++) {
    const o = i * STRIDE, p = [out.data[o], out.data[o + 1], out.data[o + 2]];
    if (p[1] < 0.2) continue;
    n++;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    local.push(p);
  }
  check(`${name}: out on the floor it's drawn`, n > 30, `${n} vertices above the floor`);
  check(`${name}: under the ceiling`, hi[1] <= spec.h + 0.05, `top ${hi[1].toFixed(2)} of ${spec.h}`);
  // in the room's own frame: every world point back to u, v
  const toUV = (p) => { const o = L.world(0, 0, 0), eu = L.world(1, 0, 0), ev = L.world(0, 1, 0);
    const a = [eu[0] - o[0], eu[2] - o[2]], c = [ev[0] - o[0], ev[2] - o[2]], q = [p[0] - o[0], p[2] - o[2]];
    const det = a[0] * c[1] - a[1] * c[0]; return [(q[0] * c[1] - q[1] * c[0]) / det, (a[0] * q[1] - a[1] * q[0]) / det]; };
  // the vehicle's own: not the door drawn on the wall it came through
  const uvs = local.filter((p) => p[1] > 0.3).map(toUV).filter(([a, c]) => Math.abs(a) < spec.w / 2 - 0.3 && c > 0.3 && c < spec.d - 0.3);
  const ub = [Math.min(...uvs.map((x) => x[0])), Math.max(...uvs.map((x) => x[0])), Math.min(...uvs.map((x) => x[1])), Math.max(...uvs.map((x) => x[1]))];
  // the door it came through stands on that wall, so leave a margin off it
  const box = S ? S.box : [-L.spec.w / 2, L.spec.w / 2, 0, L.spec.d];
  const inBox = uvs.filter((x) => x[0] > box[0] - 0.7 && x[0] < box[1] + 0.7 && x[1] > box[2] - 0.7 && x[1] < box[3] + 0.7).length / Math.max(1, uvs.length);
  check(`${name}: out on the floor it stands in its box`, inBox > 0.9, `${(inBox * 100).toFixed(0)}% in, extent ${ub.map((x) => x.toFixed(1)).join(',')} box ${box.map((x) => x.toFixed(1)).join(',')}`);
  const solid = (L.solid || []).filter((q) => q._hoist);
  check(`${name}: out on the floor it blocks the walker`, solid.length >= 1, `${solid.length} boxes`);
  // across the room, no key; beside it, the server's verb
  you = [L.spec.w / 2 - 0.4, 0.5];
  H.frame(NOW);
  check(`${name}: across the room there's no key to climb in`, btn()?.hidden === true);
  // a step off its side as drawn; in a slip, on the quay a step off the water
  you = S?.water ? [S.box[1] + 0.4, (ub[2] + ub[3]) / 2] : [ub[1] + 0.6, (ub[2] + ub[3]) / 2];
  H.frame(NOW);
  check(`${name}: beside it, the key that seats you`, btn()?.hidden === false && btn()?.dataset.cmd === R.board, `${btn()?.hidden} ${btn()?.dataset.cmd}`);
  // sent back and gone
  H.load(null, { kind: R.kind, moveMs: 9000, from: S?.from || 'below', label: 'X', mine: [], lift: null });
  const after = createBatch(256);
  H.into(after, NOW);
  check(`${name}: gone, it blocks nothing but water`, (L.solid || []).filter((q) => q._hoist).length === (S?.water ? 1 : 0));
  H.dispose();
}

console.log(fails ? `room-stand: ${fails} of ${checks} checks failed` : `room-stand: ${checks}/${checks} passed`);
process.exit(fails ? 1 : 0);
