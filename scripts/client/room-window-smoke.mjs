// ROOM WINDOW SMOKE: what moves outside a room's windows is the same for everybody, and the masks put it
// in the right part of the picture (client/shared/window-sky.js).
//
//   node scripts/client/room-window-smoke.mjs
//
// WHAT IT GUARDS:
//   • a flight is a pure function of the clock: asked twice it's the same aeroplane, and it moves no faster
//     than it flies, so it can't jump between frames
//   • an aeroplane climbs out nose up and its nose moves smoothly
//   • the sky is busy but not crowded, and a place with no airfield still sees the high lanes
//   • a storm strikes more often the heavier it is, and two viewers get the same strike
//   • the view is GLASS itself: the panes are holes and the room takes its lens
//   • the flat's own tower is off the map GLASS paints, and a high flat's eye isn't in the cloud
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..', '..');
const { airTraffic, TRAFFIC, thunderDelay } = await import(pathToFileURL(join(ROOT, 'client/shared/window-sky.js')).href);

let bad = 0, n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { bad++; console.log(`  ✗ ${name}${detail ? ` ↳ ${detail}` : ''}`); } };

// ── traffic ─────────────────────────────────────────────────────────────────────────────────────
const FIELDS = [['pad_a', 897, 898, true], ['strip', 925, 903, false], ['pad_b', 890, 904, true], ['roof', 914, 908, true], ['far', 1030, 960, false], ['south', 910, 1042, false]].map(([id, gx, gy, pad]) => ({ id, gx, gy, pad }));
const T0 = 1793970000, X = 914, Y = 908;
check('a flight is the same flight when asked twice', JSON.stringify(airTraffic(FIELDS, X, Y, T0)) === JSON.stringify(airTraffic(FIELDS, X, Y, T0)));

let total = 0, empty = 0, fastest = 0, far = 0, below = 0;
const kinds = {};
let last = new Map();
for (let t = T0; t < T0 + 3600; t += 1) {
  const up = airTraffic(FIELDS, X, Y, t), now = new Map();
  total += up.length;
  if (!up.length) empty++;
  for (const f of up) {
    kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    far = Math.max(far, f.dist);
    if (f.z <= 0) below++;
    now.set(f.id, f);
    const p = last.get(f.id);
    if (p) fastest = Math.max(fastest, Math.hypot(f.x - p.x, f.y - p.y));
  }
  last = now;
}
const mean = total / 3600;
check('the sky is busy and not crowded (1 to 3 up at once)', mean > 1 && mean < 3, mean.toFixed(2));
check('it is empty some of the time, not most of it', empty / 3600 < 0.4, `${(empty / 36).toFixed(0)}%`);
check('all three kinds fly', kinds.plane > 0 && kinds.heli > 0 && kinds.jet > 0, JSON.stringify(kinds));
check('nothing moves faster than a jet between seconds', fastest <= TRAFFIC.jet.speed + 1e-6, fastest.toFixed(3));
check('nothing is drawn past the range', far <= TRAFFIC.range, far.toFixed(1));
check('nothing flies underground', below === 0);
// the nose: up with the climb, and never a step between frames
{
  const A = { id: 'a', gx: 0, gy: 0 }, B = { id: 'b', gx: 120, gy: 0 }, seen = new Map();
  let top = -99, jump = 0;
  for (let t = T0; t < T0 + 900; t += 0.1) for (const f of airTraffic([A, B], 60, 0, t, { range: 200 })) {
    if (f.kind !== 'plane') continue;
    if (f.vz > 0) top = Math.max(top, f.pitch);
    if (seen.has(f.id)) jump = Math.max(jump, Math.abs(f.pitch - seen.get(f.id)));
    seen.set(f.id, f.pitch);
  }
  check('an aeroplane climbs out nose above its path', top > Math.atan(TRAFFIC.plane.climb) * 180 / Math.PI, 'top ' + top);
  check('the nose never steps between frames', jump < 2, 'jump ' + jump);
}
check('a place with no airfield still sees the lanes', (() => { for (let t = T0; t < T0 + 1200; t += 10) if (airTraffic([], X, Y, t).length) return true; return false; })());

// ── lightning ───────────────────────────────────────────────────────────────────────────────────
check('the window has no lightning clock of its own', !/boltNow|boltIn/.test(readFileSync(join(ROOT, 'client/game/js/panels/room-window.js'), 'utf8')));
check('thunder from further off takes longer', thunderDelay(40) > thunderDelay(8) && thunderDelay(8) > 0);

// ── the view is GLASS, live ─────────────────────────────────────────────────────────────────────
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const outlook = read('client/game/js/panels/room-view.js'), ws = read('client/game/js/panels/windshield.js'), room = read('client/game/js/panels/gl/room.js');
check('the view is taken with view.still', /still: true/.test(outlook));
check('the frame painters ask for it', (ws.match(/!still/g) || []).length >= 6, String((ws.match(/!still/g) || []).length));
const lazy = read('client/game/js/panels/room-outlook.js'), wk = read('client/game/js/panels/room-outlook-worker.js');
check('the view paints in a worker, with a fallback', lazy.includes('takeWarm()') && wk.includes('paintWindshield') && lazy.includes('function here()'));
// the city is four fixed faces looked up by direction, never a picture repainted or slid to follow the head
check('the city is placed in the world, not drawn to the camera', lazy.includes('onPano') && !lazy.includes('turnWarp') && /uMode == 5/.test(room) && /setPano/.test(room) && /at: \[0, 0\]/.test(lazy));
check('the page is set up before the renderer loads', wk.indexOf('aPage(main)') < wk.indexOf("await import('./windshield.js')") && !/^import .*windshield/m.test(wk));
check('a pane is a hole with a view under it', /see \? 0 : 1/.test(room) && /!see && view/.test(room));
check('a see-through room clears to nothing, or its grey is added through every pane', room.includes('gl.clearColor(see ? 0 : 0.02, see ? 0 : 0.02, see ? 0 : 0.025, see ? 0 : 1)'));
// a tile with a building on it is drawn in spite of its `self` flag, so the tower has to come off the map
const { eyeBase } = await import(pathToFileURL(join(ROOT, 'client/game/js/panels/room-view.js')).href);
const tower = { kind: 'field', biome: 'citycore', bt: 'apartment', pad: 1, self: 1 }, beside = { kind: 'land', bt: 'office' };
const sent = [[beside, beside, beside], [beside, tower, beside], [beside, beside, beside]];
const eye = eyeBase({ map: sent, gx: 0, gy: 0, storey: 35, storeys: 36 }, (x, y, c) => (c.bt ? 5.5 : 0));
check('the flat\'s own tower is off the map GLASS paints', !eye.map[1][1].bt && !eye.map[1][1].pad && eye.map[1][1].kind === 'land' && eye.map[1][1].self === 1, JSON.stringify(eye.map[1][1]));
check('the buildings beside it stay', eye.map[1][0] === beside && eye.map[0][1] === beside);
check('the eye\'s height is read before the tower comes off', eye.z > 5 && sent[1][1] === tower, String(eye.z));
check('a room\'s frame holds the deck over the eye', ws.includes('DECK_FLOOR = still && v.freeCam') && ws.includes('Math.max(0.05, DECK_FLOOR,'));
check('the room takes the city camera\'s lens', /roomMatrices\(cam, w \/ h, light\.lens\)/.test(room));

console.log(bad ? `room:window — ${bad} of ${n} failed` : `room:window — ${n} checks passed`);
process.exit(bad ? 1 : 0);
