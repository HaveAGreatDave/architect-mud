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
const { pickInteriors, roomBounds, interiorsFrame, INTERIOR_TUNE, interiorTuneFor, oneWorldBlocker, oneWorldTakes, sameStorey } = await imp('client/game/js/panels/glass/interiors-near.js');
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
  // a weak PC (the frame governor down) spends its interiors on the building you're in
  const weak = interiorTuneFor(0.25, false, null), shut = interiorTuneFor(1, true, null);
  check('a struggling frame draws fewer interiors, nearer', weak.max < INTERIOR_TUNE.max && weak.mid < INTERIOR_TUNE.mid && weak.maxNear < INTERIOR_TUNE.maxNear);
  check('a phone takes the low tune', shut.max === 6 && shut.maxNear === 2);
  check('a PC that keeps up takes the full tune', interiorTuneFor(1, false, null) === INTERIOR_TUNE);
  const other = { ...room('next', 0.3), gx: 1 };
  const inside = pickInteriors([...rooms, other], [0.1, 0.1, 0.1], interiorTuneFor(0.5, false, '0,0'));
  check('inside on a weak PC, another building\'s rooms aren\'t drawn', !inside.some((x) => x.room.key === 'next') && inside.some((x) => x.room.key === 'in' && x.lod === 0));
  const insideFull = pickInteriors([...rooms, other], [0.1, 0.1, 0.1], interiorTuneFor(1, false, '0,0'));
  check('inside, another building\'s room is never whole', insideFull.find((x) => x.room.key === 'next')?.lod === 1);
  // inside, your own building's rooms stay whole on a struggling frame, and none of them is drawn as its box: a box
  // under your floor is a lid over the stairwell (Golden Goose Gardens, 2026-11-23)
  check('inside on a struggling frame, your building still keeps eight rooms whole', interiorTuneFor(0, false, '0,0').maxNear >= 8 && interiorTuneFor(0, false, null).maxNear < 8);
  const lidded = interiorsFrame(inside.map((x) => ({ ...x, lod: x.mine ? 1 : x.lod })), -3, 2, { inside: true });
  check('inside, no room of your own building is drawn as its box', !lidded.some((x) => x.lod === 1 && inside.find((y) => y.mine && x.key.startsWith(y.room.key + '#'))));
  const f = interiorsFrame(p, -3, 2);
  check('a frame entry is keyed by its level', f.some((x) => x.key === 'mid#box') && f.some((x) => x.key === 'in#mesh'));
  check('a frame entry is moved to the map window', near(f[0].M[12], 3) && near(f[0].M[13], -2));
  // a whole room whose mesh is still building in the worker (room-interiors.js meshReady) is its box meanwhile
  const wait = interiorsFrame(p.map((x) => (x.room.key === 'in' ? { ...x, room: { ...x.room, meshReady: () => false } } : x)), -3, 2);
  check('a room still building is drawn as its box', wait.some((x) => x.key === 'in#box' && x.lod === 1) && !wait.some((x) => x.key === 'in#mesh'));
  // from inside its own building the box would be a grey slab across the room: it's left out until its mesh is back
  const inWait = interiorsFrame(p.map((x) => (x.room.key === 'in' ? { ...x, mine: true, room: { ...x.room, meshReady: () => false } } : x)), -3, 2, { inside: true });
  check('inside, a room of your own building still building isn\'t drawn as a box', !inWait.some((x) => x.key.startsWith('in#')) && inWait.some((x) => x.key === 'near#mesh'));
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
// ⚠ dispatch.js never passed them on until 2026-11-21: the server sent every lobby's rooms and the street never drew one
check('dispatch hands the rooms to both opens, the warm one and the real one', (disp.match(/interiors: msg\.interiors/g) || []).length >= 2);
check('a reconnect forgets which rooms were sent', /on\('player\.logout'[^\n]*roomsSent\.delete\(id\)/.test(fl));
check('the street view keeps them and hands them to the frame', /keepInteriors\(s, allSentInteriors\(\)\)/.test(fv) && /interiorRooms: st\.foot/.test(fv));
check('a room the street view drew is walked into in GLASS, told the room before it', /if \(freelookTakeRoom\(msg, prev\)\) \{ (setRoomButton\(\{ open: true \}\); )?(if \(msg\.world\) roomVeilOff\(\); else )?dropPreVeil\('room-stage', true\);/.test(disp) && /prev = lastRoomView; lastRoomView = \{ zone: msg\.zone, car: !!msg\.lift \};/.test(disp) && /freelookTakeRoom = ifLoaded/.test(lazy));
check('indoors, the server\'s close doesn\'t park the view', /msg\?\.indoors && freelookInside\(\)/.test(disp));
check('inside, the room\'s own floor holds you', /if \(s\.inside\) return insideBlock/.test(fv) && /roomFree\(r\.L/.test(fv));
check('one world is off until it\'s turned on', /export const ONE_WORLD = \{ on: false\b/.test(fv));

// ── the windows in the shell (step 2): a room's panes stand on its own walls, facing out ────────────────────────
{
  const { roomPanes } = await imp('client/game/js/panels/glass/interiors-near.js');
  for (const bearing of [0, 90, 225]) {
    const spec = { w: 6, d: 8, h: 3, face: 30, windows: [{ wall: 'front', a: -2, b: 1, y0: 0.9, y1: 2.2 }, { wall: 'left', a: 2, b: 5, y0: 1, y1: 2 }, { wall: 'back', a: 0, b: 2 }] };
    const L = roomLayout(spec), M = roomToGlass(L, [0.1, -0.2], bearing, 0);
    const P = roomPanes(spec, L, M);
    check(`bearing ${bearing}: every pane is a quad`, P.length === 3 && P.every((q) => q.quad.length === 4));
    const front = P[0], fl = apply(M, L.world(-2, 0, 2.2));
    check(`bearing ${bearing}: a front pane's corner is on the front wall`, near(front.quad[0][0], fl[0]) && near(front.quad[0][1], fl[1]) && near(front.quad[0][2], fl[2]));
    // the step into the room points at the room's middle
    const mid = apply(M, L.world(0, L.d / 2, 1.5));
    for (const q of P) check(`bearing ${bearing}: a pane's way in is into the room`, (mid[0] - q.c[0]) * q.n[0] + (mid[1] - q.c[1]) * q.n[1] > 0 && near(Math.hypot(q.n[0], q.n[1]), 1));
  }
  check('a windowless room has no panes', roomPanes({ w: 4, d: 4, h: 3, windowless: true, windows: [{ wall: 'front', a: 0, b: 1 }] }, roomLayout({ w: 4, d: 4, h: 3 }), roomToGlass(roomLayout({ w: 4, d: 4, h: 3 }), [0, 0], 0, 0)).length === 0);
  const ri = read('client/game/js/panels/room-interiors.js'), gi = read('client/game/js/panels/gl/interiors.js'), nr = read('client/game/js/panels/glass/interiors-near.js');
  check('a room carries its panes', /panes: roomPanes\(r\.spec, L, M\)/.test(ri) && /panes: room\.panes/.test(nr));
  check('the frame turns panes facing the eye into portals', /function panePortals/.test(ws) && /panePortals\(list, rel\)/.test(ws));
  check('a pane portal draws only its own room', /!p\.room \|\| e\.r\.key === p\.room/.test(gi));
  check('a street door\'s backing asks only after door portals', /filter\(\(p\) => !p\.room\)/.test(ws));
  check('each portal is filled from its own scissored patch', /gl\.scissor\(box\[0\]/.test(gi) && /function screenBox/.test(gi) && gi.includes('p.quads || [p.quad]'));
  check('the portal target is let go of its unit before the next one draws into it', /the target off its unit/.test(gi));
  // a wall's panes are one portal: the room is drawn once for them all
  check('the panes of one wall share a portal', /had\.quads\.push\(q\.quad\)/.test(ws));
}

// ── which rooms one-world takes (oneWorldBlocker; freelook-view.js oneWorldRoom calls it) ───────────────
{
  const front = { dir: 'south', kind: 'front', to: 'zone_street' };
  const L = (spec, placed = []) => ({ spec: { openings: [front], ...spec }, placed });
  check('a plain entry room is taken', oneWorldBlocker(L({})) === null);
  check('a room with no street door stays on the Stage', oneWorldBlocker({ spec: { openings: [{ dir: 'north', kind: 'door', to: 'b' }] }, placed: [] }) === 'not-entry');
  check('a front opening into the same building is not a street door', oneWorldBlocker(L({}), (z) => z === 'zone_street') === 'not-entry');
  // a laid-out piece keeps its stock on itself and drops the row's `serves` (room-layout.js layRows): Screw It's counter
  // a shop counter's Shop is a typed verb and commerce's panel, so a shop is walked in GLASS; a vending machine and a cooker aren't
  check('a shop counter laid out by layRows is walked in GLASS', oneWorldBlocker(L({}, [{ form: 'tradecounter', stock: 'chem' }])) === null);
  check('a vending machine is walked in GLASS, its flavours and plug on the card', oneWorldBlocker(L({}, [{ form: 'vendor' }])) === null);
  check('a cooker or a lab is walked in GLASS, the kitchen opening over it (phase F)', oneWorldBlocker(L({}, [{ arche: 'hob', form: 'cooktop' }])) === null && oneWorldBlocker(L({}, [{ arche: 'cabinet', lab: true }])) === null && /const glassHost = !roomHost \? document\.querySelector\('#area-content \.fl-root'\) : null;/.test(read('client/game/js/panels/kitchen-stage.js')));
  check('a lift car is walked in GLASS since phase E', oneWorldBlocker(L({ car: true })) === null);
  check('a balcony or a roof deck is walked in GLASS', oneWorldBlocker(L({ balcony: {} })) === null && oneWorldBlocker(L({ open: true })) === null);

  // phase A: a room that isn't an entry is taken from inside its building in GLASS, on your storey, and never on a phone
  const at = (z, spec, placed) => ({ gx: 5, gy: 7, M: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1], L: L(spec, placed) });
  const lobby = at(0, {}), hall = { ...at(0, {}), L: { spec: { openings: [{ dir: 'south', kind: 'door', to: 'lobby' }] }, placed: [] } };
  const upstairs = { ...hall, M: at(0.3).M };
  const inLobby = { gx: 5, gy: 7, room: lobby };
  check('an entry room is taken from the street', oneWorldTakes(lobby, null, () => false));
  check('a phone keeps the Stage', !oneWorldTakes(lobby, null, () => false, true));
  check('a hall is taken from the lobby on its storey', oneWorldTakes(hall, inLobby, () => false));
  check('a hall is not taken from the street or the Stage', !oneWorldTakes(hall, null, () => false));
  check('a room upstairs is taken from inside its building (a flight, or a typed up with no stair)', oneWorldTakes(upstairs, inLobby, () => false));
  check('a room upstairs is not taken from the street', !oneWorldTakes(upstairs, null, () => false));
  check('a room in another building is not taken', !oneWorldTakes(hall, { ...inLobby, gx: 6 }, () => false));
  check('a lift car is taken from inside its building', oneWorldTakes({ ...hall, L: { spec: { car: true, openings: [] }, placed: [] } }, inLobby, () => false));
  // the storey is the matrix's height, not L.floor (0 for every room, which made the whole building one storey)
  check('storeys come from the matrix', sameStorey(lobby, hall) && !sameStorey(lobby, upstairs));
  // the server sends a building's rooms once a session, so the view keeps them before any branch can drop the open
  const fv = read('client/game/js/panels/freelook-view.js');
  check('openFreelook keeps the sent rooms first', /export function openFreelook\(ctx = \{\}\) \{\s*if \(ctx\.interiors\) noteInteriors\(ctx\.interiors\);/.test(fv));
  check('a fresh view on foot starts with every sent building', /if \(sentInteriors\.size\) keepInteriors\(s, allSentInteriors\(\)\);[^]*bindFootDock/.test(fv) || (fv.match(/keepInteriors\(s, allSentInteriors\(\)\)/g) || []).length >= 2);
  // phase B: the card inside. The Stage's aim and GLASS's are one sum (room-layout.js roomAim)
  const { facedPiece, glassActs, STAGE_ONLY, seatFor, sitCmd } = await imp('client/game/js/panels/oneworld-card.js');
  const room = { ft: 1, seats: [{ piece: 'sofa', u: -3, v: 0.5 }], stations: [{ piece: 'fridge', u: 0, v: 2 }, { piece: 'bath', u: 0, v: 3, annex: true }] };
  const pcs = [{ id: 'fridge', name: 'fridge', acts: [{ verb: 'open', cmd: 'open fridge' }, { verb: 'workspace', cmd: 'workspace' }] }, { id: 'sofa', name: 'sofa' }, { id: 'bath', name: 'bath', annex: true }];
  check('the card is for the piece ahead of you', facedPiece(room, pcs, [0, 0], [0, 1])?.id === 'fridge');
  check('nothing behind you is faced', facedPiece(room, pcs, [0, 0], [0, -1]) === null);
  check('a seat you turn to is faced', facedPiece(room, pcs, [0, 0], [-1, 0])?.id === 'sofa');
  check('the en-suite isn\'t offered from the main room', facedPiece({ ...room, stations: [room.stations[1]], seats: [] }, pcs, [0, 0], [0, 1]) === null);
  const acts = glassActs(pcs[0]);
  check('the card sends each line\'s typed verb', acts[0]?.cmd === 'open fridge' && acts.some((a) => a.verb === 'examine'));
  check('a line only the Stage can work stays off the card', !acts.some((a) => STAGE_ONLY.has(a.verb)) && STAGE_ONLY.has('join') && acts.some((a) => a.verb === 'workspace'));
  check('Change clothes, Music, Cook, a set\'s Watch and a keypad are on the card', !STAGE_ONLY.has('dress') && !STAGE_ONLY.has('music') && !STAGE_ONLY.has('workspace') && !STAGE_ONLY.has('watch') && !STAGE_ONLY.has('keypad'));
  // a Cachet (plugins/concealment): its keypad only for whoever room_view says may know of it, and a turned one cooks
  const cab = { id: 'cab', name: 'cabinet', keypad: true };
  check('a keypad is offered only when the room says you may know of it', !glassActs(cab).some((a) => a.verb === 'keypad') && glassActs(cab, [], { keypad: true })[0]?.cmd === 'keypad cabinet');
  const turned = glassActs({ ...cab, turned: true }, [], { keypad: true });
  check('a turned Cachet cooks first and keeps its keypad last', turned[0]?.verb === 'workspace' && turned[turned.length - 1]?.verb === 'keypad');
  {
    const tv = { id: 'tv', name: 'television', arche: 'screen', acts: [{ verb: 'watch', cmd: 'watch television' }] };
    check('a set\'s Watch says which way it\'ll go', glassActs(tv, [], { tvOn: true }).find((a) => a.verb === 'watch')?.label === 'Turn it off' && glassActs(tv, [], { tvOn: false }).find((a) => a.verb === 'watch')?.label === 'Turn it on');
    const gi = read('client/game/js/panels/gl/interiors.js');
    check('a set that\'s on shows its picture in GLASS, uploaded only when it changes', /if \(uScreenOn > 0\.5\) \{ outColor = vec4\(texture\(uScreen, vUv\)\.rgb, 1\.0\); return; \}/.test(gi) && /if \(t && t\.ver === sc\.ver\) return t;/.test(gi) && /screen: !lod && room\.screen \? room\.screen : null/.test(read('client/game/js/panels/glass/interiors-near.js')) && /\{ batch: m\.screen, screen: true \}/.test(read('client/game/js/panels/room-interiors.js')));
    check('a set somebody in the room has on comes on, and goes off with them unless you turned it on', /if \(I\.npcTv && !s\.owTv\.on && !I\.npcTvAsked\)/.test(fv) && /if \(!I\.npcTv && I\.tvFromNpc && s\.owTv\.on\)/.test(fv) && /npcTv: !!msg\.tv/.test(fv));
    const gi2 = read('client/game/js/panels/gl/interiors.js');
    check('the paint on a room\'s walls is drawn in GLASS, cut out by its alpha, its glow added and its foil over it', /if \(uDecalOn > 0\.5\) \{ vec4 t = texture\(uScreen, vUv\); if \(t\.a < 0\.06\) discard;/.test(gi2) && /const kind = \(d\) => \(d\.glow != null \? 2 : d\.foil != null \? 3 : 1\);/.test(gi2) && /if \(r\.decals\) tris \+= drawDecals\(r\);/.test(gi2) && /decals: !lod && room\.decals && room\.decals\.length \? room\.decals : null/.test(read('client/game/js/panels/glass/interiors-near.js')));
    check('the street view paints the walls with the Stage\'s own builders and takes room_tags and room_sheets', /if \(st\.foot\) owDecals\(st\);/.test(fv) && /t\.tagDecals\(L, I\.tags\)/.test(fv) && /sh\.sheetDecals\(L, runs,/.test(fv) && /room_tags: \(msg\) => \{ if \(freelookWalls\(msg, 'tags'\)\) return;/.test(disp) && /room_sheets: \(msg\) => \{ if \(freelookWalls\(msg, 'sheets'\)\) return;/.test(disp));
    check('a poster\'s picture coming in tells both views, each by its own listener', /const artHeard = new Map\(\);/.test(read('client/game/js/panels/room-sheets.js')) && /sh\.onArt\(\(\) => \{[^}]*\}, 'glass'\)/.test(fv));
    check('the set\'s page sits off the side of the window wherever a set is made, by room-tv.js\'s own sheet', /^\.rs-tv \{[^}]*left: -20000px/m.test(read('client/game/js/panels/room-tv.css')) && /ensureTvStyles\(\);/.test(read('client/game/js/panels/room-tv.js')) && !/#room-stage \.rs-tv[ .{-]/.test(read('client/game/js/panels/room-stage.css')));
    check('the card is drawn again when a line\'s label changes, not only its verb', /acts\.map\(\(a\) => a\.verb \+ ':' \+ a\.label\)\.join\(\)/.test(read('client/game/js/panels/oneworld-card.js')));
    const gi3 = read('client/game/js/panels/gl/interiors.js');
    check('a whole room is lit lamp by lamp from where they hang, a box by the old tint', /lamps: !lod && room\.lampsNow \? room\.lampsNow\(\) : null/.test(read('client/game/js/panels/glass/interiors-near.js')) && /'lamps'[,\]]/.test(read('client/game/js/panels/room-interiors.js')) && /lamps \+= uLamp \* uLampP\[i\]\.w \* face/.test(gi3) && /gl\.uniform1i\(u\('uLampN'\), ls\.length\);/.test(gi3));
    {
      // the projector: gl/interiors.js keeps last frame's matrix and puts a frame point on the picture through it
      const src = read('client/game/js/panels/gl/interiors.js');
      check('a point of a room is put on the picture by the matrix the room was drawn with', /this\.lastVp = vp; this\.lastO = \[ox, oy\];/.test(src) && /projectThrough\(this\.lastVp, x - this\.lastO\[0\], y - this\.lastO\[1\], z, 1, 1\)/.test(src) && /export function glInteriorProject\(id, x, y, z\)/.test(read('client/game/js/panels/gl/world.js')) && /interiorProject: \(x, y, z\) => \(rooms \? rooms\.project\(x, y, z\) : null\)/.test(read('client/game/js/panels/gl/context.js')));
      check('a flat\'s control panel\'s page is laid on its glass in GLASS and let go out, parked or handed to the Stage', /if \(st\.foot\) owEnvctlTick\(st\);/.test(fv) && /glInteriorProject\(s\.id, q\[0\] \+ r\.gx - s\.gx, q\[1\] \+ r\.gy - s\.gy, q\[2\]\)/.test(fv) && (fv.match(/s\.owEnv\.ui\.stop\(\); s\.owEnv\.host\.remove\(\); s\.owEnv = null;/g) || []).length >= 4);
    }
    check('a depot\'s vehicle stands on its floor in GLASS, its panel up, made again only while it moves', /if \(st\.foot\) owHoistTick\(st, now\);/.test(fv) && /H\.ui\.into\(b, now\);/.test(fv) && /if \(r\.extra\) tris \+= drawExtra\(r\);/.test(read('client/game/js/panels/gl/interiors.js')) && /extra: !lod && \(room\.extra \|\| room\.lockExtra \|\| room\.vendExtra \|\| room\.cookExtra[^)]*\)/.test(read('client/game/js/panels/glass/interiors-near.js')) && /room_vehicles: \(msg\) => \{ if \(freelookVehicles\(msg\)\) return;/.test(disp));
    check('the hoist\'s panel is styled in GLASS as on the Stage', /:is\(#room-stage, \.fl-root\) \.rh-panel \{/.test(read('client/game/js/panels/room-hoist.css')));
    check('a flat\'s control panel dims the rooms drawn in GLASS as it does the Stage\'s', /window\.addEventListener\('envctl:light'/.test(fv));
    check('the street view makes the set inside and stops it out, parked or handed to the Stage', /if \(st\.foot\) owTvTick\(st, now\);/.test(fv) && (fv.match(/s\.owTv\.stop\(\); s\.owTv = null;/g) || []).length >= 4);
  }
  check('Change clothes opens the street Pack on the wardrobe, Music the player', /a\.verb === 'dress'\) \{ footPack\(s, 'wear', \{ wardrobe:/.test(fv) && /a\.verb === 'music'\) \{ import\('\.\/lazy-views\.js'\)\.then\(\(m\) => m\.openMusicPlayerPanel\(\)\)/.test(fv));
  // a locked doorway inside: the Stage's lines and its rule for who gets through (client/shared/room-locks.js)
  const { lockActs, lockLetsThrough } = await imp('client/shared/room-locks.js');
  const { facedLock } = await imp('client/game/js/panels/oneworld-card.js');
  check('a door with no lock lets you through', lockLetsThrough(undefined));
  check('an open door, or a shut one that knows you, lets you through', lockLetsThrough({ open: true }) && lockLetsThrough({ pass: true, locked: true }));
  check('a locked door, a shut one that doesn\'t know you, or a shut bathroom holds you', !lockLetsThrough({ locked: true }) && !lockLetsThrough({}) && !lockLetsThrough({ pass: true, annex: true }));
  check('a locked door offers Unlock and Hack', lockActs({ dir: 'north', locked: true, hack: true }).map((a) => a.cmd).join() === 'unlock door north,hack door north');
  check('a door that knows you unlocks then opens', lockActs({ dir: 'east', locked: true, pass: true })[0].then === 'open door east');
  check('the Stage\'s hologram and GLASS\'s card read one lockActs', /import \{ lockActs, DOOR_WORD \} from '\.\.\/\.\.\/\.\.\/shared\/room-locks\.js'/.test(read('client/game/js/panels/room-lock.js')) && !/export function lockActs/.test(read('client/game/js/panels/room-lock.js')));
  {
    const Ld = roomLayout({ w: 4, d: 6, h: 2.6, face: 0, openings: [{ dir: 'north', to: 'z_hall', wall: 'back', a: -0.45, b: 0.45, kind: 'door' }] });
    const o = Ld.spec.openings?.[0], inside = o && (await imp('client/shared/room-layout.js')).openingInside(Ld, o)?.at;
    const lk = [{ to: 'z_hall', dir: 'north', locked: true }];
    if (inside) {
      check('the door you stand at and face has its card', facedLock(Ld, lk, [inside[0], inside[1] - 0.5], [inside[0], inside[1] + 0.5])?.to === 'z_hall');
      check('the door behind you doesn\'t', facedLock(Ld, lk, [inside[0], inside[1] - 0.5], [inside[0], inside[1] - 1.5]) === null);
      check('a door across the room doesn\'t', facedLock(Ld, lk, [inside[0], inside[1] - 4], [inside[0], inside[1] - 3]) === null);
    } else check('a test room with a doorway lays out', false, JSON.stringify(Ld.spec.openings));
  }
  check('a shut door holds you inside, both ways', (fv.match(/!owDoorLets\(s, os?\)/g) || []).length >= 2);
  check('a lock that changes reaches the room you walk in GLASS', /room_locks: \(msg\) => \{ if \(freelookLocks\(msg\)\) return;/.test(disp) && /freelookLocks = ifLoaded/.test(lazy));
  // phase E: the storeys. Stairs, the floor under you, lift landings and coming out of the Stage's lift ride
  {
    const near = await imp('client/game/js/panels/glass/interiors-near.js');
    const at = (z, ops) => ({ gx: 5, gy: 7, M: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1], L: { spec: { openings: ops }, placed: [] } });
    const landing = at(0.3, [{ dir: 'in', kind: 'door', lift: true, to: 'z_car' }]);
    check('a lift car and its landing are both walked in GLASS', near.oneWorldBlocker({ spec: { car: true, openings: [] }, placed: [] }) === 'not-entry' && near.oneWorldBlocker(landing.L) === 'not-entry');
    check('out of the Stage\'s lift ride onto its landing, GLASS takes it', near.oneWorldTakes(landing, null, () => false, false, { fromLift: 'z_car' }));
    check('another car\'s landing isn\'t taken', !near.oneWorldTakes(landing, null, () => false, false, { fromLift: 'z_other' }));
  }
  {
    // the cut round a building on several tiles: read off the window map's po cells, never the rooms' boxes
    const i0 = fv.indexOf('export function cutFootprint'), body = fv.slice(i0, fv.indexOf('\n}\n', i0) + 2).replace('export ', '');
    const cutFootprint = new Function('CUT_TILE_REACH', body + '\nreturn cutFootprint;')(0.52);
    const cell = (po) => (po ? { kind: 'land', po } : { kind: 'land' });
    // a 5 by 5 window about 100,200; a 2 by 2 tower with its facade at 100,200 and quarters east and south of it
    const map = Array.from({ length: 5 }, (_, y) => Array.from({ length: 5 }, (_, x) => ((x === 3 && y === 2) || (x === 2 && y === 3) || (x === 3 && y === 3) ? cell([100, 200]) : cell())));
    const f = cutFootprint(map, 100, 200, 100, 200), one = cutFootprint(map, 100, 200, 99, 200);
    check('a 2 by 2 building is cut across its four tiles', f.cx === 100.5 && f.cy === 200.5 && Math.abs(f.reach - 1.02) < 1e-9, JSON.stringify(f));
    check('a one-tile building is cut on its own tile', one.cx === 99 && one.cy === 200 && Math.abs(one.reach - 0.52) < 1e-9, JSON.stringify(one));
    check('the storey cut reads the map\'s footprint', /const f = cutFootprint\(s\.map, s\.gx, s\.gy, r\.gx, r\.gy\)/.test(fv));
  }
  {
    // phase C: a room's people, stood where the Stage stands them and handed to the street's figure
    const { placePeople, roomPeopleRecords } = await imp('client/game/js/panels/oneworld-people.js');
    const { token } = await imp('client/shared/person-token.js');
    const Lp = roomLayout({ w: 4, d: 6, h: 2.6, face: 0 });
    const ppl = [{ id: 'me' }, { id: 'npc_post', npc: true, at: [1, 2], face: [0, 1] }, { id: 'npc_free', npc: true, sex: 'female' }, { id: 'npc_bath', annex: true }, { id: 'npc_bed', posture: 'lying', on: 'nothere' }];
    const pl = placePeople(Lp, ppl, 'me');
    check('you aren\'t drawn in your own room, nor anybody in the en-suite', !pl.some((q) => q.p.id === 'me' || q.p.id === 'npc_bath'));
    check('somebody at a post stands there', pl.find((q) => q.p.id === 'npc_post')?.at.join() === '1,2');
    const free = pl.find((q) => q.p.id === 'npc_free');
    check('somebody nobody placed gets a spot on clear floor, and keeps it', !!free && placePeople(Lp, ppl, 'me').find((q) => q.p.id === 'npc_free')?.at.join() === free.at.join());
    const room = { gx: 10, gy: 20, L: Lp, M: roomToGlass(Lp, [0, 0], 0, 0) };
    const rec = roomPeopleRecords(room, ppl, 'me');
    check('the records are in absolute tiles about the building', rec.length >= 2 && rec.every((q) => Math.abs(q.x - 10) < 1 && Math.abs(q.y - 20) < 1 && Number.isFinite(q.hd)), JSON.stringify(rec[0]));
    check('dressed by the street\'s own token', rec.find((q) => q.t === token('npc_free'))?.s === 1 && /import \{ token \} from '\.\.\/\.\.\/client\/shared\/person-token\.js'/.test(read('server/engine/street-actors.js')));
    check('the street view hands them to the frame and takes room_people', /roomPeople: st\.inside \? owPeople\(st\) : null/.test(fv) && /room_people: \(msg\) => \{ if \(freelookPeople\(msg\)\) return;/.test(disp));
    const { facedPerson } = await imp('client/game/js/panels/oneworld-people.js');
    const { personActs } = await imp('client/shared/room-acts.js');
    check('the person you face is on the card', facedPerson(Lp, ppl, 'me', [1, 1], [1, 1.5])?.id === 'npc_post');
    check('nobody behind you is', facedPerson(Lp, ppl, 'me', [1, 1], [1, 0.5])?.id !== 'npc_post');
    check('a person offers Talk first, and a dancer on shift her tips', personActs({ name: 'Mina' })[0].cmd === 'talk mina' && personActs({ name: 'Roxy', tip: true }).some((a) => a.cmd === 'tip roxy 50'));
    check('the Stage and GLASS read one personActs', /personActs as personLines \} from '\.\.\/\.\.\/\.\.\/shared\/room-acts\.js'/.test(read('client/game/js/panels/room-stage.js')) && /acts: personActs\(who\)/.test(fv));
    {
      const { noteMoves } = await imp('client/game/js/panels/oneworld-people.js');
      const Lw = roomLayout({ w: 4, d: 6, h: 2.6, face: 0, openings: [{ dir: 'north', to: 'z_hall', wall: 'back', a: -0.45, b: 0.45, kind: 'door' }] });
      const rw = { gx: 10, gy: 20, L: Lw, M: roomToGlass(Lw, [0, 0], 0, 0) }, walks = new Map();
      const after = [{ id: 'npc_in', npc: true }];
      noteMoves(walks, Lw, { came: [{ id: 'npc_in', from: 'z_hall' }] }, [], after, 'me', 1000);
      const mid = roomPeopleRecords(rw, after, 'me', walks, 1200);
      check('somebody coming in walks from the doorway', walks.has('npc_in') && mid[0]?.clip === 'walk' && mid[0].gd > 0, JSON.stringify(mid[0]));
      const done = roomPeopleRecords(rw, after, 'me', walks, 1e9);
      check('and stands at their spot once they\'re in', done[0]?.clip !== 'walk' && !walks.has('npc_in'));
      const w2 = new Map();
      noteMoves(w2, Lw, { gone: [{ id: 'npc_in', to: 'z_hall' }] }, after, [], 'me', 1000);
      check('somebody leaving walks to the door and is drawn till they\'re through', w2.has('npc_in') && roomPeopleRecords(rw, [], 'me', w2, 1100).length === 1 && roomPeopleRecords(rw, [], 'me', w2, 1e9).length === 0);
    }
    {
      const lay = await imp('client/shared/room-layout.js');
      const Lc = roomLayout({ w: 8, d: 8, h: 3, face: 0 }, [{ id: 'c', name: 'counter', form: 'tradecounter', arche: 'surface', u: 0, v: 5, w: 3, d: 0.8, h: 1.05, turn: 0 }]);
      const spots = lay.lineSpots(Lc, lay.linePoints(Lc)[0], 5).map((q) => q.at.join());
      const crowd = placePeople(Lc, Array.from({ length: 8 }, (_, i) => ({ id: 'npc_' + i, npc: true })), null);
      check('some customers queue at a counter, one behind another', crowd.filter((q) => spots.includes(q.at.join())).length >= 1 && crowd.filter((q) => spots.includes(q.at.join())).every((q, i, a) => a.findIndex((r) => r.at.join() === q.at.join()) === i));
    }
    {
      const { routesOf } = await imp('client/game/js/panels/oneworld-people.js');
      const crossing = [{ id: 'npc_r', npc: true, route: { path: [[-1, 1], [1, 4]], ms: 4000 } }], rts = routesOf(crossing, 0);
      const rm = { gx: 10, gy: 20, L: Lp, M: roomToGlass(Lp, [0, 0], 0, 0) };
      const half = roomPeopleRecords(rm, crossing, 'me', null, 2000, rts)[0], end = roomPeopleRecords(rm, crossing, 'me', null, 1e9, rts)[0];
      const endAt = roomPeopleRecords(rm, [{ id: 'npc_r', npc: true, at: [1, 4] }], 'me')[0];
      check('somebody the server sends across the room walks their route, and stands at its end', half?.clip === 'walk' && end?.clip !== 'walk' && Math.abs(end.x - endAt.x) < 1e-9 && Math.abs(end.y - endAt.y) < 1e-9);
    }
    check('in a conversation the camera comes in on their face and goes back after, and you don\'t walk', /window\.addEventListener\('npc:talk'/.test(fv) && /if \(st\.foot\) owTalkTick\(st, now\);/.test(fv) && /st\.inside\?\.talkCam \? st\.inside\.talkCam\.z :/.test(fv) && /if \(s\.inside\?\.talkCam\) return \[x0, y0\];/.test(fv));
    check('Talk turns you to face them', /if \(a\.verb === 'talk' && piece\?\.person\) owFace\(s, piece\.person\.id\);/.test(fv) && /r\.t === personToken\(id\)/.test(fv));
    check('windshield draws them', /drawRoomPeople\(ctx, cam, v, wcx, wcy, night, now, FAR\);/.test(read('client/game/js/panels/windshield.js')));
  }
  {
    // phase D: a room's lamps follow its switch (the Stage's own, one store) and its mains
    const { litOf } = await imp('client/shared/room-lights.js');
    check('a room with no power is dark, one with power and its switch on lit', !litOf('z_nowhere', 'off') && litOf('z_nowhere', 'on') && litOf('z_nowhere', undefined));
    const rsrc = read('client/game/js/panels/room-stage.js');
    check('a piece moved in a room walked in GLASS builds the room again, its old mesh drawn till then', fv.includes('if (owRepiece(msg.zone, I.pieces)) keepInteriors') && fv.includes('r.ver = (r.ver || 0) + 1'));
    check('a MORPHEX pod in a room walked in GLASS runs the Stage sequence, its halves out of the mesh', fv.includes('M.ui = m.createMorphex({ L: r.L, piece: q') && fv.includes('r.hideMesh?.([], q.id);') && fv.includes('M.room.morphExtra = f.props?.n') && disp.includes('if (visual && freelookMorphex()) { closeMorphexPanel(); return; }'));
    check('a room glows light it as plain points through the vat lights', read('client/game/js/panels/gl/interiors.js').includes('V && V.e === e ? V.light : glowLight(e.r, ox, oy)') && fv.includes('M.room.morphGlows = f.glows?.length') && fv.includes('r.glowLive = g.length ? g : null'));
    check('a room halos are added over the picture by the beasts halo shader', read('client/game/js/panels/gl/interiors.js').includes('layerProgram(gl, HALO_VS, linearOut(HALO_FS)') && fv.includes('M.room.haloLive = f.halos?.n'));
    check('the arrange mode runs over a room walked in GLASS, its walls down in the room override and its picking on the GLASS lens', fv.includes('ra.createArrange({ root: s.root, host: s.root, S, R, rebuild') && fv.includes('r.override(A.ui?.on ? A.ui.cut(rm.buildRoom(S.L, opts)) : null)') && read('client/game/js/panels/room-arrange.js').includes('hr = ray ? ray(x / w, y / h) : null') && read('client/game/js/panels/room-interiors.js').includes('override(m) {') && disp.includes("if (freelookArrange('arranged', msg)) return;"));
    check('a studio set claiming a room walked in GLASS is the TV live stage over it, asked again as its people change', fv.includes("owRaw({ type: 'room_set', zone: msg.zone })") && fv.includes('O.ui = createStudioFloor(s.root') && disp.includes('room_set: (msg) => { if (freelookSet(msg)) return;'));
    check('a stadium room walked in GLASS has its champion board, banners and signs by room-stadium.js, and never the ice', fv.includes('const ui = stadMod.createRoomStadium({ R, host });') && fv.includes('...(I.stadDecals || [])') && fv.includes("setUnder: () => {}"));
    check('a rink room in GLASS waits behind its switch, its openings painted with the arena picture where they land on the screen', read('client/game/js/panels/glass/interiors-near.js').includes('if (sp.rink && !RINK_IN_GLASS.on) return') && fv.includes('K.ui.tick(now, { eye: M.eye') && read('client/game/js/panels/gl/interiors.js').includes('if (uScreenOn > 1.5) { vec2 q = gl_FragCoord.xy'));
    check('the resurfacer stands in its bay in GLASS and drives out at the break, made again only while it moves', fv.includes('mc.into(b);') && fv.includes('r.machineExtra = b.n'));
    check('examining a trophy case in GLASS takes the camera round its Cup by room-closeup.js, and puts you back after', fv.includes('C.ui = rc.createCloseup({ host: s.root, target') && fv.includes('owTakeCam(s, C.room, C.home') && fv.includes("a.verb === 'examine' && piece"));
    { const g = read('client/game/js/panels/gl/interiors.js').split(String.fromCharCode(13)).join(''), at = g.indexOf('\n  return {\n'), end = g.indexOf('\nexport ', at); check('the interiors layer declares no state below its return, where a let or const is never set', at > 0 && !/\n  (let|const) /.test(g.slice(at, end > 0 ? end : undefined))); }
    check('the other animals in a room are drawn in GLASS by the beasts batch the Stage uses', fv.includes('beastMod.beastsBatch(r.L, list') && fv.includes('r.beastExtra = batch.n'));
    check('the Stage and GLASS keep one light switch', /import \{ switchOf, saveSwitch, litOf \} from '\.\.\/\.\.\/\.\.\/shared\/room-lights\.js'/.test(rsrc) && !/function switchOf/.test(rsrc) && /interiorRoomsOf\(b, \{ shift, lampOn: owLit, lampLevel: owLevel(, was: by)? \}\)/.test(fv));
    check('the dimmer scales a room\'s lamp, and - and = work it inside', /lamp: on && !r\.spec\?\.unlit \? LAMP_RGB\.map\(\(c\) => c \* Math\.max\(0\.1, Math\.min\(1, Number\(lampLevel\(r\.zone\)\) \|\| 1\)\) \* \(Number\(r\.spec\?\.dim\) \|\| 1\)\) : null/.test(read('client/game/js/panels/room-interiors.js')) && /k === '-' \|\| k === '_' \|\| k === '=' \|\| k === '\+'/.test(fv));
    check('the mains and L relight the rooms drawn in GLASS', /room_power: \(msg\) => \{ freelookPower\(msg\);/.test(disp) && /k === 'l'[^\n]*saveSwitch\(z, !sw\.on, sw\.level\); owRelight\(s\);/.test(fv));
  }
  check('taken from the Stage, you stand inside the way back to the room it last showed', /const back = !from && was\?\.zone \? ops\.find\(\(q\) => q\.to === was\.zone && \(q\.dir \|\| q\.lift\)\) : null;/.test(fv));
  check('a step through a doorway or up a flight the server never answers puts you back', (fv.match(/owGoing\(s, x0, y0\);/g) || []).length >= 1 && /if \(st\.foot\) owGoingTick\(st, flash\);/.test(fv) && /if \(s\.inside\) s\.inside\.going = null;/.test(fv));
  check('no answer, but the server has you in the new room: you stay and the room is asked for again', /if \(state\.currentZone && state\.currentZone === I\.zone\) \{ s\.foot\.onMove\('room'\); return; \}/.test(fv));
  check('a reconnect while walking a room in GLASS asks for the room again', /if \(wasReconnect && freelookInside\(\)\) sendCmdSilent\('room'\);/.test(disp));
  {
    const css = read('client/game/js/panels/oneworld-card.css');
    check('the card hides the street view\'s hint and stands above the walking ring', /\.fl-root:has\(\.ow-card:not\(\[hidden\]\)\) \.fl-hint \{ display: none; \}/.test(css) && /html\[data-density="compact"\] \.fl-root:has\(\.fc-ring\) \.ow-card \{ bottom: 160px; \}/.test(css));
  }
  check('a room is taken in GLASS only for a building inside the view\'s window', /if \(!room \|\| !inWindow \|\| !oneWorldRoom\(s, room, fromLift\)\)/.test(fv));
  {
    // phase D: the outside through a room's windows, by the Stage's own ear
    const { earOf } = await imp('client/game/js/panels/oneworld-sound.js');
    const Le = roomLayout({ w: 4, d: 6, h: 2.6, face: 0 }), spec = { w: 4, d: 6, windows: [{ wall: 'front', a: -1, b: 1 }] };
    const e = earOf(Le, spec, [0.5, 3], [0.5, 2], 90, 2, 1000, 12, 'rain');
    check('the ear hears the nearest window, facing the way you look', e.spot?.out?.join() === '0,-1' && e.near === 3 && e.pose.fwd[1] === -1 && e.storey === 2, JSON.stringify(e.spot));
    check('the street view plays it inside and stops it out, parked or closed', /if \(st\.foot\) owSoundTick\(st\);/.test(fv) && (fv.match(/s\.owSound\.stop\(\); s\.owSound = null;/g) || []).length >= 4);
  }
  check('a lift car comes once a landing, the copy where it\'s parked taken, its floors on the card, the same spot after a ride', /rooms\.push\(\{ zone: id, key: id \+ '@' \+ stop\.zone, stop: stop\.zone, spec, pieces, frame \}\);/.test(read('plugins/roomstage/index.js')) && /\.\.\.\(lift\.parked \? \{ parked: lift\.parked \} : \{\}\)/.test(read('plugins/roomstage/index.js')) && /const room = liftCopy\(s, msg\.zone, msg\.lift\);/.test(fv) && /cmd: `floor \$\{f\.n\}`/.test(fv) && /owRide\(s, from\.room, room\)/.test(fv) && /bk = \(r\.key \|\| r\.zone\)/.test(read('client/game/js/panels/room-interiors.js')));
  check('a doorway or a flight inside takes you to the room past it at the Stage\'s line', /const next = os\?\.dir \? \(s\.interiors \|\| \[\]\)\.find\(\(q\) => q\.zone === os\.to && q\.gx === I\.gx && q\.gy === I\.gy && \(!q\.stop \|\| q\.stop === I\.zone\)\) : null;/.test(fv) && /if \(r\) return r === I\.room;/.test(fv) && /I\.stairTo = \{ room: next, from: I\.room\.zone \}/.test(fv) && /function owStairTick/.test(fv) && /owStairTick\(st\)/.test(fv));
  check('inside, the eye stands off the floor under you on any storey', /\(st\.inside \? owFloorZ\(st\) : footLift\(st, dt\)\)/.test(fv) && /L\.groundAt\(p\[0\], p\[1\]\)/.test(fv));
  check('a lift\'s doors from its landing send the move and keep you there', /if \(o && o\.dir && o\.lift\) \{/.test(fv));
  check('a landing taken from the Stage closes the Stage', /const stageUp = !!document\.getElementById\('room-stage'\)[^\n]*if \(freelookTakeRoom\(msg, prev\)\) \{[^\n]*if \(stageUp\) roomMod\?\.then\(\(m\) => m\.closeRoomStage\(true, null, \{ fade: true \}\)\)/.test(disp));
  const vm = glassActs({ id: 'vm', name: 'Soda Machine', form: 'vendor', vend: { menu: [{ item: 'cola', label: 'Cola', price: 3 }] } });
  check('a vending machine offers its flavours as typed verbs', vm[0]?.cmd === 'vend soda machine cola' && vm.some((a) => a.verb === 'nudge') && /const acts = vendorActs;/.test(read('client/game/js/panels/room-vendor.js')));
  check('a seat offers sitting', glassActs(pcs[1], [{ piece: 'sofa' }]).some((a) => a.verb === 'sit'));
  check('the Stage aims with the shared sum', /return roomAim\(L, at, fu, fv, opts\.aimable\)/.test(read('client/game/js/panels/room-walk.js')));
  // sitting, as the Stage's runAct and onSit do it
  const sat = glassActs(pcs[1], [{ piece: 'sofa' }], { sat: true });
  check('sat, Get up comes first and there\'s no sitting again', sat[0]?.verb === 'stand' && !sat.some((a) => a.verb === 'sit' || a.verb === 'lie'));
  const lounger = [{ piece: 'l', lie: true, verb: 'lie' }], sofaSeats = [{ piece: 's', verb: 'sit' }, { piece: 's', lie: true, verb: 'lie' }];
  check('Sit down takes a sitting seat, Lie down a lying one', seatFor(sofaSeats, 's', 'sit') === sofaSeats[0] && seatFor(sofaSeats, 's', 'lie') === sofaSeats[1]);
  check('a sit on a piece with only places to lie lies', seatFor(lounger, 'l', 'sit') === lounger[0]);
  check('a piece with no seat has none', seatFor(sofaSeats, 'x', 'sit') === null);
  check('a seat with its own verb sends it', sitCmd({ verb: 'poop' }, { name: 'toilet' }) === 'poop toilet' && sitCmd({ lie: true }, { name: 'bed' }) === 'lie bed');
  check('sat, the eye is the seat\'s and a step gets you up', /st\.inside\?\.sat \? st\.inside\.sat\.z/.test(fv) && /if \(s\.inside\?\.sat\) return \[x0, y0\]/.test(fv) && /s\.inside\?\.sat && down && !e\.repeat && FOOT_KEYS\.has\(k\)\) owStand\(s\)/.test(fv));
  check('a click on the picture holds the card', /bindFootPointer\(glass, freeCam, \(e\) => owClick\(self, e, glass\),/.test(fv));
  check('the street view keeps the room\'s pieces and ticks the card', /pieces: msg\.pieces \|\| \[\]/.test(fv) && /owCardTick\(st, now\)/.test(fv) && /s\.owCard\.key\(k\)/.test(fv));
  check('freelook-view compares storeys with sameStorey, never L.floor', !/L\.floor\s*!==\s*I\.room\.L\.floor/.test(read('client/game/js/panels/freelook-view.js')));
}

// THE CLONE HALL IN GLASS (phase F): the fluid, the machines, the sleepers and the monitors, as on the Stage
{
  const gi = read('client/game/js/panels/gl/interiors.js'), fv = read('client/game/js/panels/freelook-view.js'), rv = read('client/game/js/panels/gl/room-vat.js');
  const ri = read('client/game/js/panels/room-interiors.js'), rs = read('client/game/js/panels/room-stage.js'), disp = read('client/game/js/dispatch.js');
  // the eye the vat layer is handed is the camera's own: column 2 of the inverse view-projection, as GLASS's eyePos has it
  const { viewProjMatrix, eyePos } = await imp('client/game/js/panels/gl/camera.js');
  const { invert } = await imp('client/game/js/panels/gl/core/mat4.js');
  let worst = 0;
  for (const [h, back, pitch] of [[0.3, 0, 0], [2.1, 1.5, 0.2], [-1.2, 0.4, -0.35]]) {
    const cam = { sinh: Math.sin(h), cosh: Math.cos(h), back, fx: 3.2, fy: -1.7, EH: 0.14, pitch, FL: 900, W: 1600, depth: 900, horizonY: 450, near: 0.02 };
    const Vi = invert(viewProjMatrix(cam, 900), new Float64Array(16)), E = [Vi[8] / Vi[11], Vi[9] / Vi[11], Vi[10] / Vi[11]], P = eyePos(cam);
    worst = Math.max(worst, Math.hypot(E[0] - P[0], E[1] - P[1], E[2] - P[2]));
  }
  check('the vat layer is handed the camera\'s own eye, off the inverse view-projection (' + worst.toExponential(1) + ' tiles off)', worst < 1e-6);
  check('a vat hall\'s vats run in GLASS by the Stage\'s own layer, through the room\'s matrix', /import\('\.\/room-vat\.js'\)/.test(gi) && /vatMod\.createVatLayer\(gl, \{\}\)/.test(gi) && /vp: multiply\(vp, M, new Float32Array\(16\)\)/.test(gi) && /vatLayer\.draw\(V\.vp, V\.eye, w, h, \{ now, amb, lin: LIN\.out > 0 \}\);/.test(gi) && /vatLayer\.step\(now, V\.eye\);/.test(gi) && /vatLive: !lod && room\.vatLive \? room\.vatLive : null, figLive: !lod && room\.figLive \? room\.figLive : null, catLive: !lod && room\.catLive \? room\.catLive : null, (glowLive: [^,]+, )?(haloLive: [^,]+, )?vatsNow: room\.vatsNow/.test(read('client/game/js/panels/glass/interiors-near.js')));
  check('the room you\'re in draws its close-up figures (the lying, the sleepers) and the vats over them', /if \(FV\) tris \+= liveDraw\(FV, light\);/.test(gi) && /if \(V\.live\) tris \+= vatDraw\(V\);/.test(gi) && /if \(st\.foot\) owFigTick\(st, now\);/.test(fv) && /lyingBodies\(r\.L, I\.people, I\.you\)/.test(fv) && /V\.bodies = \[\.\.\.sl\.vatSleepers\(r\.L, vs, t\), \.\.\.coming\];/.test(fv));
  // the partials: locked doors' leaves and hologram, vending machines, the sets' foil and the join, the TV under the pointer
  {
    const ni = read('client/game/js/panels/glass/interiors-near.js'), lc = read('client/game/js/panels/room-lock.css');
    check('a locked doorway in GLASS has its steel leaves and the hologram off its reader, by room-lock.js', /if \(st\.foot\) owLockTick\(st, now\);/.test(fv) && /lockMod\.m\.createRoomLocks\(\{ host, send:/.test(fv) && /r\.lockExtra = K\.batch\?\.n \? \{ batch: K\.batch, ver: K\.ver \} : null;/.test(fv) && /if \(lockLetsThrough\(k\)\) \{ s\.owLock\?\.ui\.enter\(o\.to\); return true; \}/.test(fv) && (fv.match(/owLockStop\(s\);/g) || []).length >= 4);
    check('the hologram is styled over the street view as on the Stage', !/(^|[,}\s])#room-stage \./m.test(lc) && /:is\(#room-stage, \.fl-root\) \.rl-layer/.test(lc));
    check('a room\'s live parts are a list: the depot\'s vehicle, the leaves, a vending machine', /\[room\.extra, room\.lockExtra, room\.vendExtra, room\.cookExtra[^\]]*\]\.filter\(Boolean\)/.test(ni) && /const xs = Array\.isArray\(r\.extra\) \? r\.extra : \[r\.extra\];/.test(gi));
    check('a vending machine is drawn in GLASS by room-vendor.js, with what the server says it shows', /if \(st\.foot\) owVendTick\(st, now\);/.test(fv) && /vendMod\.m\.createRoomVendor\(/.test(fv) && /vend: by\.get\(String\(p\.id\)\)\?\.vend/.test(fv) && /room_piece: \(msg\) => \{ if \(freelookPiece\(msg\)\) return;/.test(disp) && /s\.owVend\?\.ui\.press\(piece\.id, a\.item\)/.test(fv) && /s\.owVend\?\.ui\.hitAt\(/.test(fv));
    check('a decal\'s glow is added and its foil shimmers, as gl/room.js modes 7 and 8', /for \(const pass of \[1, 3, 2\]\)/.test(gi) && /outColor = vec4\(t\.rgb \* t\.a \* uDecalK, 0\.0\);/.test(gi) && /float band = pow\(max\(0\.0, sin\(\(along \* 1\.6/.test(gi) && !/d\.foil == null\);/.test(gi));
    check('a whole set not yet seen to join plays its join in GLASS, the camera taken and given back, a click skipping it', /sh\.createSheetScene\(\{ L: r\.L, run: pick\.run/.test(fv) && /localStorage\.setItem\(owJoinKey\(r, I\.join\.set\), '1'\)/.test(fv) && /if \(I\.join\) \{ I\.join\.scene\.skip\(\); return; \}/.test(fv) && /st\.inside\?\.joinCam \? st\.inside\.joinCam\.z/.test(fv));
    check('the set under the pointer takes a click, shows its buttons and the wheel tunes it, by the Stage\'s own sum', /export function quadUV\(q, x, y\)/.test(read('client/shared/quad-uv.js')) && /export \{ quadUV \} from '\.\.\/\.\.\/\.\.\/shared\/quad-uv\.js';/.test(read('client/game/js/panels/room-tv.js')) && /return sc \? quadUV\(/.test(rs) && /m\.quadUV\(q, e\.clientX - box\.left, e\.clientY - box\.top\)/.test(fv) && /btn = on && s\.owTv\?\.buttonAt\(on\.u, on\.v\)/.test(fv) && /'screens'\];/.test(ri) && /m\.paintBoot\(c, s\.owTv\.canvas, bt, boot\)/.test(fv));
    const { quadUV } = await imp('client/shared/quad-uv.js');
    const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }], tq = [{ x: 10, y: 0 }, { x: 90, y: 10 }, { x: 90, y: 60 }, { x: 10, y: 50 }];
    const a1 = quadUV(sq, 25, 40), a2 = quadUV(tq, 50, 30);
    check('a point on a set\'s screen comes back where it is on it, square on or turned', a1 && Math.abs(a1.u - 0.25) < 1e-9 && Math.abs(a1.v - 0.8) < 1e-9 && a2 && Math.abs(a2.u - 0.5) < 1e-6 && Math.abs(a2.v - 0.5) < 1e-6 && quadUV(sq, 120, 10) === null);
  }
  // cooking at the room's own hob, on the ring you choose, in GLASS and on the Stage
  {
    const ks = read('client/game/js/panels/kitchen-stage.js'), kj = read('client/game/js/panels/gl/kitchen.js'), rm = read('client/game/js/panels/gl/room-mesh.js'), ni = read('client/game/js/panels/glass/interiors-near.js');
    const { hobRings, homeRing, cookFrameOf } = await imp('client/game/js/panels/room-cook.js');
    const hob = { id: 'h1', arche: 'hob', form: 'range', u: 0.4, v: 1.2, turn: 0, w: 0.76, d: 0.66, h: 0.9 };
    const Lk = { placed: [hob], spec: {}, world: (u, v, y) => [u, y, v] };
    const rings = hobRings(hob), F = cookFrameOf(Lk, hob, false, null), F0 = cookFrameOf(Lk, hob, false, 0);
    const off = Math.hypot(F.o[0] - hob.u, F.o[2] - hob.v), self = F.rings?.[F.ring]?.at || [9, 9], other = F.rings?.[0]?.at || [0, 0];
    check('a range\'s kitchen stands on one of its four drawn rings, never the middle of the top (' + off.toFixed(3) + ' m off it)', rings.length === 4 && F.ring === homeRing(rings) && off > 0.1 && Math.hypot(self[0], self[1]) < 1e-6 && Math.abs(Math.hypot(other[0], other[1]) - Math.hypot(30, 26)) < 0.5);
    check('another ring is another burner, its frame moved onto that ring', F0.ring === 0 && Math.hypot(F0.o[0] - F.o[0], F0.o[2] - F.o[2]) > 0.3 && hobRings({ form: 'microwave' }).length === 0 && hobRings({ form: 'cooktop', w: 0.76, d: 0.66 }).length === 2);
    check('the hob\'s mesh draws its rings from the same table the kitchen stands on', (rm.match(/for \(const \{ x, z, r: rr \} of hobRings\(p\)\)/g) || []).length === 2 && !/const rings = range \?/.test(rm));
    check('the Stage and GLASS stand the kitchen by one rule (room-cook.js)', /import \{ cookFrame, cookersIn, coldIn \} from '\.\/room-cook\.js';/.test(rs) && !/^function cookFrame\(/m.test(rs) && /import \{ cookFrame, cookersIn, coldIn \} from '\.\/room-cook\.js';/.test(fv));
    check('a pan dragged onto a ring goes there, the burner with the pan you\'re working with', /function ringTo\(i\)/.test(ks) && /function carryTo\(id, i\)/.test(ks) && /if \(i != null && g\.kind === 'carry'\) return carryTo\(g\.id, i\);/.test(ks) && /S\.drag = \{ kind: 'carry', id: otherPanAt\(e\)\.id/.test(ks) && /followRing\(\);/.test(ks) && /localStorage\.setItem\(k, String\(i\)\)/.test(ks) && /setRing: \(i\) => /.test(rs) && /setRing: \(i\) => /.test(fv));
    check('the kitchen picks through its host\'s own matrix, and lays its set into the frame as it moves', /const d = M\.ray \? M\.ray\(sx, sy\)/.test(kj) && /return \(host\.matrices && host\.matrices\(\)\) \|\| cameraMatrices/.test(kj) && /if \(src && laidFor !== F\)/.test(kj));
    check('in GLASS the kitchen is drawn at the room\'s hob: its kit, its host, its pieces on the room, the fridges it draws left out', /if \(roomHost \|\| glassHost\) \{/.test(ks) && /window\.addEventListener\('kitchen:open', \(e\) => owCookOpen\(st, e\)\);/.test(fv) && /r\.cookExtra = \{ batch: v\.props, ver: \+\+ver \};/.test(fv) && /room\.cookExtra[^\]]*\]\.filter\(Boolean\)/.test(ni) && /hideMesh\(ids(, busy = null)?\)/.test(ri) && /room\.meshTag \? room\.meshTag\(\)/.test(ni) && /function owKitchenMatrices\(s, r, F\)/.test(fv) && /export function glInteriorVP\(id\)/.test(read('client/game/js/panels/gl/world.js')));
    check('cooking in GLASS you still walk and look, and walking off shuts the kitchen', /ks\.classList\.contains\('ks-hosted'\) && !st\.inside\?\.cookCam/.test(fv) && /turn: \(dx, dy\) =>/.test(fv) && /S\.host\.turn\(e\.clientX - g\.x, e\.clientY - g\.y\)/.test(ks) && /window\.dispatchEvent\(new Event\('kitchen:walkaway'\)\)/.test(fv));
  }
  // a pet cat in GLASS, by the Stage's own pieces
  {
    const cl = read('client/game/js/panels/gl/cat-layer.js'), cx = read('client/game/js/panels/gl/context.js'), ni = read('client/game/js/panels/glass/interiors-near.js');
    check('a cat in GLASS is the Stage\'s own: its day (catsFrame), its carves (catDrawer) and its voice, into GLASS\'s cat layer', /if \(st\.foot\) owCatTick\(st, now, hour\);/.test(fv) && /b\.catsFrame\(r\.L, I\.beasts, \{/.test(fv) && /g\.catDrawer\(R, \{ furBudget: 480000 \}\)/.test(fv) && /C\.voice\.tick\(f\.voices\);/.test(fv) && /w\.glRoomCats\(s\.id\)/.test(fv) && /export function glRoomCats\(id\)/.test(read('client/game/js/panels/gl/world.js')));
    check('the cat layer skins the beast shader and the ink on the GPU, loaded the first time a cat is near', /skinVariant\(BEAST_VS\)/.test(cl) && /skinVariant\(INK_VS\)/.test(cl) && /layerProgramAsync/.test(cl) && /import\('\.\/cat-layer\.js'\)/.test(cx) && /cats: \(VP, list, env\) => \(catl \? catl\.draw\(VP, list, env\) : false\)/.test(cx) && /catLive: !lod && room\.catLive/.test(ni) && /F\.cats\(V\.vp, cats\.cats,/.test(gi));
    check('the cats come with room_view and room_people, and stroking him sends the typed pet', /beasts: msg\.beasts \|\| \[\],/.test(fv) && /I\.beasts = msg\.beasts \|\| \[\];/.test(fv) && /s\.foot\.onMove\('pet ' \+ p\.name \+ ' ' \+ p\.spot\)/.test(fv) && /b\.catHit\(project,/.test(fv) && /onPress && \(grab = onPress\(e\)\)/.test(fv));
    check('one room light for the figures and the cats in GLASS', /export function setRoomLight\(gl, P, env, cssW, cssH\)/.test(read('client/game/js/panels/gl/room-light-uniforms.js')) && /setRoomLight\(gl, LIT, env, w, h\)/.test(cl) && /roomLight\(gl, P, env, cssW, cssH\)/.test(read('client/game/js/panels/gl/street-hd.js')));
  }
  {
    // somebody lying on a bed is a close-up body on the bed's own seat, asleep; the crowd leaves them out
    const { lyingBodies, roomPeopleRecords } = await imp('client/game/js/panels/oneworld-people.js');
    const bed = { piece: 'b1', u: 0.5, v: 2, yaw: 0.4, lie: true, head: [0, 0.9], top: 0.55 };
    const Lb = { seats: [bed], placed: [], bounds: [-2, 2, 0, 4], world: (u, v, y) => [u, y, v], local: (p) => [p[0], p[2]], groundAt: () => 0 };
    const ppl = [{ id: 'n1', posture: 'lying', on: 'b1', asleep: true, sex: 'female' }];
    const lb = lyingBodies(Lb, ppl, null), rec = roomPeopleRecords({ L: Lb, M: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1], gx: 0, gy: 0 }, ppl);
    check('somebody lying down is a close-up body on the bed\'s seat, asleep, and not in the crowd', lb.length === 1 && lb[0].pose === 'lie' && lb[0].seat === bed && lb[0].head === bed.head && lb[0].rest === 'sleep' && rec.length === 0);
  }
  check('the vats light the room they stand in, their caustics from one call site', /lamps \+= C\.rgb \* C\.rgb \* fall/.test(gi) && (gi.match(/vatCaustic\(/g) || []).length === 2 && /drawRoom\(e, ox, oy, null, V && V\.e === e \? V\.light : (null|glowLight\(e\.r, ox, oy\))\)/.test(gi));
  check('a vat hall takes its glass and draws it after the fluid, less each vat\'s still fill', /const VAT_FIELDS = \[\.\.\.MESH_FIELDS, 'glass', 'vats', 'gantries'\];/.test(ri) && /glass: true, cut: \(m\.vats \|\| \[\]\)\.map\(\(v\) => v\.glass\)/.test(ri) && /if \(p\.glass\) continue;/.test(gi) && /if \(uGlassOn > 0\.5\)/.test(gi));
  check('a copy of the picture behind a vat or a censor\'s panel is as float as the picture', /copy\.fl !== fl/.test(rv) && /fl \? gl\.RGBA16F : gl\.RGBA8/.test(rv) && /censorTarget\(w, h, (drawsFloat\(gl, saved\.draw\)|saved\.fl)/.test(read('client/game/js/panels/gl/figure-hd.js')) && /export function drawsFloat\(gl, fb\)/.test(read('client/game/js/panels/gl/core/texture.js')));
  check('the vats\' colours go linear when GLASS\'s target is', /const C = \(c\) => \(lin \? linRgb\(c\) : c\);/.test(rv) && !/uniform3fv\(GEAR\.u\('uBase'\), base\)/.test(rv) && !/uniform3fv\(VOL\.u\('uCol'\), v\.col\)/.test(rv));
  check('the Stage and GLASS pose the same sleepers, from one module', /import \{ vatSleepers, sleeperCapsules \} from '\.\/room-vat-sleepers\.js';/.test(rs) && !/function vatSleepers\(/.test(rs) && /sl\.vatSleepers\(r\.L, vs, t\)/.test(fv) && /sl\.sleeperCapsules\(q\.rows\)/.test(fv));
  check('the sleepers are drawn by the street\'s close-up figure, with its censor\'s panels', /draw: \(VP, R, env\) => streetHD\(\)\.roomReady\(\) && streetHD\(\)\.drawRoom\(VP, R, env\)/.test(read('client/game/js/panels/gl/context.js')) && /panels: true/.test(read('client/game/js/panels/gl/street-hd.js')) && /F\.censor\(V\.vp, recs, V\.eye\)/.test(gi));
  check('a body down a tube plays in GLASS from room_vat, and leaves the crowd while it does', /room_vat: \(msg\) => \{ if \(freelookVat\(msg\)\) return;/.test(disp) && /V\.cycle\.bodies\(people, S, now\)/.test(fv) && /I\.vatHide\.has\(q\.t\)/.test(fv) && /if \(st\.foot\) owVatTick\(st, now\);/.test(fv));
  check('your own arrival takes the camera into the vat and stands you out of its front', /V\.cycle\.cam\(now, S, \{\}\)/.test(fv) && /V\.cycle\.stepOut\(S, now\)/.test(fv) && /st\.inside\?\.vatCam \? st\.inside\.vatCam\.z/.test(fv));
  check('the clone hall\'s monitors are live in GLASS, with the walls\' paint', /I\.vitalList = V\.vitals\.decals\(\)/.test(fv) && /const more = \[\.\.\.\(I\.vitalList \|\| \[\]\), \.\.\.\(I\.vendDecals \|\| \[\]\)(, \.\.\.\(I\.stadDecals \|\| \[\]\))?\];/.test(fv) && /const all = \[\.\.\.I\.decalList, \.\.\.\(I\.joinDecals \|\| \[\]\), \.\.\.more\];/.test(fv));
  // and the sleepers' bodies themselves: a vat hall's vats in, a nude floating body per full vat out
  const { vatSleepers } = await imp('client/game/js/panels/room-vat-sleepers.js');
  const Lz = { placed: [{ id: 'v1', u: 0, v: 2, turn: 0 }, { id: 'v2', u: 1, v: 2, turn: 0 }], world: (u, v, y) => [u, y, v], baseAt: () => 0 };
  const sl = vatSleepers(Lz, [{ id: 'v1', c: [0, 0.3, 2], h: 1.9 }, { id: 'v2', c: [1, 0.3, 2], h: 1.9, state: 'drained' }], 1);
  check('a full vat holds a sleeper and a drained one none, nude and floating', sl.length === 1 && sl[0].vat === 'v1' && sl[0].clip === 'vatFloat' && sl[0].figure.wear.top === false && sl[0].lift > 0.3);
}

// ── a vessel's rooms (docs/proposals/echelon-decks.md, phase 2): placed in her own frame, carried as she turns ─────────
{
  const { placeOnVessel } = await imp('client/game/js/panels/room-interiors.js');
  const L = roomLayout({ w: 4, d: 4, h: 3 });
  const room = (V) => ({ L, gx: 0, gy: 0, vessel: V });
  const V = { sx: 0, fz: 1 / m2t(1), face: 0, floor: 3, deck: 5.53 };
  const at = (r, u, v) => apply(r.M, L.world(u, v, 0));
  const a = placeOnVessel(room(V), { heading: 0 }), b = placeOnVessel(room(V), { heading: 90 });
  check('a vessel room a tile forward stands a tile north of her middle with her bow north', near(at(a, 0, 0)[0], 0) && near(at(a, 0, 0)[1], -1), at(a, 0, 0).join());
  check('…and a tile east with her bow east, facing the way she does', near(at(b, 0, 0)[0], 1) && near(at(b, 0, 0)[1], 0) && at(b, 0, 2)[0] < at(b, 0, 0)[0]);
  check('its floor is her main deck and its own storey over it', near(a.M[14], m2t(5.53 + 3)), String(a.M[14]));
  const s = placeOnVessel(room({ ...V, sx: 0.2 / m2t(1), fz: 0 }), { heading: 0 });
  check('starboard is east with her bow north', near(at(s, 0, 0)[0], 0.2), String(at(s, 0, 0)[0]));
  const up = placeOnVessel(room(V), { heading: 0, ride: { heave: 0.05, pitch: 3, roll: -2 } }), up2 = placeOnVessel(room({ ...V, fz: -10 }), { heading: 0, ride: { heave: 0.05, pitch: 3, roll: -2 } });
  check('her rooms rise with her heave, every one of a deck at one height (sameStorey)', near(up.M[14] - a.M[14], 0.05) && near(up.M[14], up2.M[14]) && sameStorey(up, up2));
  check('…and its box and panes go with it', Array.isArray(up.box) && near(up.box[4], up.M[14], 1e-3) && Array.isArray(up.panes));
  const fake = { L: { spec: { openings: [{ dir: 'north', kind: 'door', to: 'x' }] } }, gx: 0, gy: 0, vessel: V };
  check('one-world takes a vessel room however you got there, a building room only from inside', oneWorldTakes(fake, null, () => true) && !oneWorldTakes({ ...fake, vessel: null }, null, () => true));
  const fv = read('client/game/js/panels/freelook-view.js'), so = read('client/game/js/panels/gl/solids.js'), rs = read('plugins/roomstage/index.js');
  const has = (src, ...xs) => xs.every((x) => src.includes(x));
  check('the view puts them on her hull every frame before the walk reads them, and carries you with the floor',
    has(fv, 'freeCam.step(dt);\n      owVesselTick(st, now);', 's.freeCam.carry(now2[0] - was[0], now2[1] - was[1])', 'seaRideAt(gx - s.gx + sub.x, gy - s.gy + sub.y, heading, now)'));
  check('her storey is cut out of her hull while you stand in it, and never left on after the view goes',
    has(so, 'uniform vec4 uVCutA;') && has(fv, 'setVesselCut(cut);', 'if (!st) return;\n  setVesselCut(null);', 'if (!r || r.vessel) return null;'));
  check('the server sends a vessel\'s rooms with her frame, from her tile as it is now',
    has(rs, 'frame: { vessel: { sx: R.at[0]', 'out.push({ tile: { x: f.grid_x, y: f.grid_y }, vessel: true, rooms: kept.rooms });'));
}

console.log(bad ? `interiors:smoke — ${bad} of ${n} failed` : `interiors:smoke — ${n} checks passed`);
process.exit(bad ? 1 : 0);

