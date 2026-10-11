// Ballpark smoke: Deadball's park in 3-D (the Grandstand) checked without a GPU.
//
// The renderer (client/game/js/panels/gl/ballpark.js) needs WebGL2, which node hasn't got, so
// this checks what it stands on, the arena-smoke pattern:
//
//   1. THE PARK IS SOUND. ballpark-mesh.js builds the whole park from the venue's defaults and
//      from a venue that overrides them: every float finite, every material one the shader
//      knows, every normal a unit, the ground inside the park's outline, the crowd in the
//      seats, and the whole inside its triangle budget. A venue's fence moves the wall, its
//      distances and the warning track's uniform; its board moves the board; its towers
//      their lamps.
//   2. THE MATRICES AGREE WITH THE PINHOLE. camera.js writes each shot out as GL matrices
//      and works the same shot out from the camera's own axes. If they drift, the director
//      (which frames with `project`) and the picture disagree about what's in shot. Every
//      shot, three screen shapes, 300 points each, to a hundredth of a pixel.
//   3. THE BOARD SAYS THE GAME. The scoreboard's lamps carry the line score, the count and
//      the names, the latest nine innings in extras, and an E only for a game that counts
//      errors.
//   4. THE FALLBACK HOLDS. With the flag off the view IS the 2-D Gameday. Forced on with no
//      WebGL2, `createBallparkRenderer` returns null rather than throwing, the view gives way
//      to the 2-D Gameday, and the booth's held line still lands with the play.
//   5. THE LIGHT AND THE LENS. Each casting tower's shadow map holds the shot's shadow sphere;
//      the occlusion reads depth back through the perspective's constants to where it was; the
//      lens is sharp at its focus and softer away from it.
//
// It proves the park builds and the cameras agree. It doesn't draw a frame: the sandbox page
// (tools/sandbox/deadball-park-test.html?park=3d) is for looking.
//
// Run:  node scripts/shapes/ballpark-smoke.mjs

import { performance as clock } from 'node:perf_hooks';
import { __install } from './rink-dom-stub.mjs';

const stub = __install();
const P = '../../client/game/js/panels/';
const M = await import(P + 'gl/ballpark-mesh.js');
const G = await import(P + 'diamond/geo.js');
const C = await import(P + 'diamond/camera.js');
const { boardLamps, BOARD_W, BOARD_H } = await import(P + 'diamond/board.js');
const { paintInfield } = await import(P + 'diamond/dirt.js');
const { createBallparkRenderer } = await import(P + 'gl/ballpark.js');
const { spotMatrix, spotReach } = await import(P + 'gl/spotshadow.js');
const { ssaoConstants, RECONSTRUCT } = await import(P + 'gl/ssao.js');
const { cocOf, DOF_MAX } = await import(P + 'gl/broadcast.js');
const { createGrandstandView } = await import(P + 'gameday-grandstand.js');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};

// ── 1. the park ──────────────────────────────────────────────────────────────
const KNOWN = new Set(Object.values(M.MAT));
// The park without its crowd, and the crowd's seats. The look-dev's park was about 54,000
// triangles and 5,100 fans; these leave room for the dugouts and the exterior.
const TRI_BUDGET = 90000, FANS = [3000, 8000];
function auditPark(label, park) {
  let tris = 0, bad = 0, badMat = 0, badN = 0, outside = 0, groundV = 0;
  for (const [key, b] of [...park.opaque, ...park.translucent]) {
    check(`${label}: batch ${key} has triangles`, b.n > 0 && b.n % 3 === 0, `${b.n} vertices`);
    tris += b.n / 3;
    const d = b.data;
    for (let v = 0; v < b.n; v++) {
      const o = v * M.STRIDE;
      for (let k = 0; k < M.STRIDE; k++) if (!Number.isFinite(d[o + k])) bad++;
      if (!KNOWN.has(d[o + 11])) badMat++;
      const nl = Math.hypot(d[o + 3], d[o + 4], d[o + 5]);
      if (Math.abs(nl - 1) > 1e-3) badN++;
      // the field's ground cells: flat at y 0 with an upward normal
      if (d[o + 11] === M.MAT.GROUND && d[o + 1] === 0 && d[o + 4] === 1) {
        groundV++;
        if (!G.insideOutline(park.outline, [d[o], 0, d[o + 2]], 48)) outside++;
      }
    }
  }
  check(`${label}: every float finite`, bad === 0, `${bad} not finite`);
  check(`${label}: every material known to the shader`, badMat === 0, `${badMat} vertices`);
  check(`${label}: every normal a unit`, badN === 0, `${badN} vertices`);
  check(`${label}: the ground is inside the park`, groundV > 1000 && outside === 0, `${outside} of ${groundV} outside`);
  check(`${label}: inside the triangle budget`, tris > 20000 && tris <= TRI_BUDGET, `${Math.round(tris)} triangles`);
  const fans = (park.crowd.sit.length + park.crowd.stand.length + park.crowd.cheer.length) / M.CROWD_STRIDE;
  check(`${label}: a crowd in the seats`, fans >= FANS[0] && fans <= FANS[1], `${fans} fans`);
  let fanBad = 0;
  for (const k of ['sit', 'stand', 'cheer']) {
    const a = park.crowd[k];
    for (let i = 0; i < a.length; i += M.CROWD_STRIDE) {
      for (let j = 0; j < M.CROWD_STRIDE; j++) if (!Number.isFinite(a[i + j])) fanBad++;
      // nobody sits on the field: every fan is up in the stands or out past the wall
      const r = Math.hypot(a[i], a[i + 2]), th = Math.atan2(a[i], a[i + 2]);
      const onField = a[i + 1] < 4 || (Math.abs(th) < Math.PI / 4 && r < G.fenceDistance(th, park.field.fence));
      if (onField) fanBad++;
    }
  }
  check(`${label}: every fan finite and in the stands`, fanBad === 0, `${fanBad}`);
  return tris;
}

// the stub's clock is hand-cranked, so the build is timed on node's own
const t0 = clock.now();
const base = M.buildPark(null);
const ms = clock.now() - t0;
const baseTris = auditPark('defaults', base);
check('defaults: builds in under 1.5 s', ms < 1500, `${ms.toFixed(0)} ms`);
check('defaults: the wall says 330, 375 and 400', base.numbers.join() === '330,375,400', base.numbers.join());
check('defaults: six towers, 24 lamps each', base.field.towers.length === 6 && base.field.towers.every((t) => t.live.length === 24));
// The booth says the lights work about sixty percent of the time.
const lit = base.field.towers.reduce((s, t) => s + t.live.filter(Boolean).length, 0) / 144;
check('defaults: about sixty percent of the lamps work', lit > 0.45 && lit < 0.8, lit.toFixed(2));
check('defaults: the same park twice', (() => { const b = M.buildPark(null); return b.crowd.sit.length === base.crowd.sit.length && b.opaque.get('plain').n === base.opaque.get('plain').n; })());
check('defaults: the board inside the outline', G.insideOutline(base.outline, base.board.c, 12));

// A venue of its own: a short porch, a deep centre field, a high wall, the board in left-centre.
const venue = { fence: { line: 315, centre: 412, height: 14 }, board: { bearing: 28 }, lampsLit: 0.9 };
const own = M.buildPark(venue);
auditPark('venue', own);
check('venue: the wall says 315 and 410', own.numbers[0] === '315' && own.numbers[own.numbers.length - 1] === '410', own.numbers.join());
check('venue: the wall stands 14 ft', (() => {
  const b = own.opaque.get('pad'); let top = 0;
  for (let v = 0; v < b.n; v++) top = Math.max(top, b.data[v * M.STRIDE + 1]);
  return Math.abs(top - 14) < 1e-6;
})());
check('venue: the board hangs at its bearing', Math.abs(Math.atan2(own.board.c[0], own.board.c[2]) * 180 / Math.PI - 28) < 1e-6);
check('venue: more of its lamps work', own.field.towers.reduce((s, t) => s + t.frac, 0) / 6 > 0.8);
check('venue: a fence stays a fence', [0, 10, 22.5, 40, 45].every((d) => {
  const th = d * G.DEG, r = G.fenceDistance(th, own.field.fence);
  return r <= 412 + 1e-9 && r >= 315 - 1e-9;
}));

// the crowd's figures
for (const kind of ['sit', 'stand', 'cheer']) for (const far of [false, true]) {
  const m = M.crowdMesh(kind, { far, towels: true });
  let bad = 0, part = 0;
  for (let i = 0; i < m.length; i++) if (!Number.isFinite(m[i])) bad++;
  for (let i = 6; i < m.length; i += M.CROWD_VERTEX) if (!(m[i] >= 0 && m[i] <= 4)) part++;
  const t = m.length / M.CROWD_VERTEX / 3;
  check(`crowd ${kind}${far ? ' (far)' : ''}: finite, parts known`, bad === 0 && part === 0 && t > 0, `${bad}/${part}`);
  check(`crowd ${kind}${far ? ' (far)' : ''}: inside its budget`, t <= (far ? 260 : 460), `${t} triangles`);
}

// ── 2. the cameras ───────────────────────────────────────────────────────────
{
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (const name of Object.keys(C.SHOTS)) for (const [w, h] of [[1200, 900], [1480, 640], [600, 800]]) {
    const m = C.shotMatrices(name, w / h);
    const shot = C.shotOf(name, w / h);
    let worst = 0, side = 0, depth = 0;
    for (let i = 0; i < 300; i++) {
      // points round the park, from the plate to the board, the ground to the lamps
      const p = [(rnd() - 0.5) * 900, rnd() * 160, -200 + rnd() * 700];
      const a = C.project(name, w, h, p), b = C.projectGL(m.viewProj, w, h, p);
      if (a && b) {
        // on screen and a little past it, where a framing question gets asked
        if (a.x > -w && a.x < 2 * w && a.y > -h && a.y < 2 * h) worst = Math.max(worst, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.d - b.d) / a.d);
        if (b.z < -1.0001 || b.z > 1.0001) depth++;
      } else if (a ? !b : b && b.d > shot.near + 1e-6) side++;
    }
    const tag = `camera ${name} ${w}x${h}`;
    check(`${tag}: GL matrix matches the pinhole`, worst < 0.01, `worst ${worst.toFixed(4)}`);
    check(`${tag}: near-plane agreement`, side === 0, `${side} points`);
    check(`${tag}: depth inside the range`, depth === 0, `${depth} points`);
    // what it looks at is the middle of the screen
    const c = C.projectGL(m.viewProj, w, h, shot.at);
    check(`${tag}: centred on what it looks at`, !!c && Math.abs(c.x - w / 2) < 0.01 && Math.abs(c.y - h / 2) < 0.01, c && `${c.x.toFixed(3)},${c.y.toFixed(3)}`);
  }
  // what each shot is for
  const on = (name, p, w = 1200, h = 900) => { const q = C.project(name, w, h, p); return !!q && q.x > 0 && q.x < w && q.y > 0 && q.y < h; };
  check('batting view: the plate, the mound and second base in frame', on('bat', [0, 0, 1]) && on('bat', [0, 1, 60.5]) && on('bat', G.BAGS[2]));
  check('batting view: still has the plate on the TV letterbox', on('bat', [0, 0, 0.7], 1480, 640));
  check('centre field: the plate and the mound in frame', on('cf', [0, 0, 0.7]) && on('cf', [0, 3, 60.5]));
  check('the bag: second base in frame', on('bag', G.BAGS[2]));
  check('high home: all three bases in frame', [1, 2, 3].every((k) => on('high', G.BAGS[k])));
  check('a wide screen narrows a long lens', C.shotOf('cf', 2.3).fov < C.SHOTS.cf.fov && C.shotOf('cf', 4 / 3).fov === C.SHOTS.cf.fov);
  check('the batting view keeps its height on a wide screen', C.shotOf('bat', 2.3).fov === C.SHOTS.bat.fov);
  // the camera never rolls: the screen's horizontal runs level
  for (const name of Object.keys(C.SHOTS)) {
    const { r } = C.axes(C.shotOf(name));
    check(`camera ${name}: never rolls`, Math.abs(r[1]) < 1e-9, r[1].toExponential(2));
  }
}

// ── 3. the board ─────────────────────────────────────────────────────────────
{
  const lampsIn = (m, x0, y0, x1, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += m[y * BOARD_W + x] ? 1 : 0; return n; };
  const v1 = { away: 'RAT', home: 'KIN', line: { away: [0, 1, 0], home: [2, 0], hAway: 3, hHome: 4 }, aScore: 1, hScore: 2, inning: 3, half: 'top', balls: 2, strikes: 1, outs: 1, batter: 'Halvorsen', pitcher: 'Okafor' };
  const a = boardLamps(v1), b = boardLamps(v1);
  check('board: the same lamps twice', a.length === BOARD_W * BOARD_H && a.every((x, i) => x === b[i]));
  check('board: the line score is lit', lampsIn(a, 0, 14, BOARD_W, 33) > 60);
  check('board: no E column for a game that counts no errors', lampsIn(a, 228, 0, 240, 33) === 0);
  const v2 = boardLamps({ ...v1, line: { ...v1.line, eAway: 0, eHome: 1 } });
  check('board: an E column for a game that does', lampsIn(v2, 228, 0, 240, 33) > 10);
  check('board: the count changes the lamps', !boardLamps({ ...v1, balls: 3 }).every((x, i) => x === a[i]));
  const extras = boardLamps({ ...v1, inning: 12, line: { away: Array(12).fill(0), home: Array(11).fill(0), hAway: 5, hHome: 6 } });
  // in the 12th the columns read 4 to 12: the first column's "4" is a 4, not a 1
  const col0 = (m) => Array.from({ length: 7 }, (_, r) => Array.from({ length: 5 }, (_, c) => m[(2 + r) * BOARD_W + 42 + c] ? 1 : 0).join('')).join('/');
  check('board: extras show the latest nine innings', col0(extras) !== col0(a), col0(extras));
  check('board: blank before a game', lampsIn(boardLamps({}), 0, 40, BOARD_W, BOARD_H) > 0 && lampsIn(boardLamps({}), 0, 14, 30, 33) > 0);
}

// ── 4. the fallback ──────────────────────────────────────────────────────────
{
  check('the infield paints without a browser', !!paintInfield(document));
  const cv = document.createElement('canvas');
  let r = 'threw';
  try { r = createBallparkRenderer(cv); } catch (e) { r = 'threw: ' + e.message; }
  check('no WebGL2: createBallparkRenderer returns null', r === null, String(r));

  // flag off: the 2-D Gameday itself
  const h1 = stub.makeHost();
  const off = createGrandstandView(h1);
  check('flag off: the view is the 2-D Gameday', typeof off.apply === 'function' && !('setShot' in off));

  // forced on with no WebGL2: it gives way to the 2-D view, and the held line lands
  const h2 = stub.makeHost();
  const v = createGrandstandView(h2, { force: true });
  check('forced on: the Grandstand', typeof v.setShot === 'function');
  const p = {
    sport: 'baseball', batter: 'Halvorsen', pitcher: 'Okafor', battingTeam: 'Rats', fieldingTeam: 'Kings', battingAbbr: 'RAT', fieldingAbbr: 'KIN',
    inning: 1, inningOrd: '1st', half: 'top', outs: 0, rbi: 0, kind: 'single', out: false, walkoff: false,
    basesBefore: [false, false, false], basesAfter: [true, false, false], moves: [{ from: 0, to: 1 }], awayScore: 0, homeScore: 0, desc: 'Single',
    pitches: [{ n: 1, type: 'FF', velo: 94, x: 0.5, y: 0.5, result: 'ball', balls: 1, strikes: 0 }, { n: 2, type: 'FF', velo: 95, x: 0.5, y: 0.5, result: 'inplay', balls: 1, strikes: 1 }],
    line: { away: [0], home: [], hAway: 1, hHome: 0 },
  };
  v.setCaption('Halvorsen lines one into right.', { held: true });
  v.apply(p);
  await v.ready();
  for (let i = 0; i < 5; i++) await null;
  check('forced on, no WebGL2: it gives way to the 2-D view', !!v.flat && !!h2.querySelector('.gd-field'));
  stub.runTimers(15000);
  const cap = h2.querySelector('.gd-cap-text');
  check('forced on, no WebGL2: the held line lands with the play', !!cap && cap.textContent === 'Halvorsen lines one into right.', cap && cap.textContent);
  v.clear();
  check('cleared', h2.children.length === 0);
}

// ── 5. the light and the lens ────────────────────────────────────────────────
{
  // Each casting tower's shadow map holds the shot's shadow sphere: the sphere's centre maps to
  // the middle of the map, and points round its rim land inside the map and inside its depth.
  const field = base.field;
  for (const name of Object.keys(C.SHOTS)) {
    const shot = C.shotOf(name);
    const [focus, radius] = shot.shadow || [[0, 0, 60], 80];
    for (const T of field.towers.filter((t) => t.base[2] >= 0)) {
      const m = spotMatrix(T.lamp, focus, radius), r = spotReach(T.lamp, focus, radius);
      const c = C.projectGL(m, 2, 2, focus);
      let out = 0;
      for (let i = 0; i < 64; i++) {
        const a = i / 64 * Math.PI * 2, b = (i % 8) / 8 * Math.PI - Math.PI / 2;
        const p = [focus[0] + Math.cos(a) * Math.cos(b) * r, focus[1] + Math.sin(b) * r, focus[2] + Math.sin(a) * Math.cos(b) * r];
        const q = C.projectGL(m, 2, 2, p);
        if (!q || q.x < 0 || q.x > 2 || q.y < 0 || q.y > 2 || q.z < -1 || q.z > 1) out++;
      }
      check(`spot shadow ${name} from (${T.base[0]}, ${T.base[2]}): the sphere is on the map`, !!c && Math.abs(c.x - 1) < 1e-6 && Math.abs(c.y - 1) < 1e-6 && out === 0, `${out} rim points off it`);
      check(`spot shadow ${name} from (${T.base[0]}, ${T.base[2]}): holds at least 25 ft round the play`, r >= Math.min(radius, 25), r.toFixed(1));
    }
  }
  // The occlusion reads depth through the five constants: a point through the GL matrix and back
  // through RECONSTRUCT comes out where it went in.
  let worst = 0;
  for (const name of Object.keys(C.SHOTS)) for (const aspect of [4 / 3, 2.3]) {
    const m = C.shotMatrices(name, aspect), k = ssaoConstants(m.proj);
    for (let i = 0; i < 50; i++) {
      // a view-space point in front of the eye: x right, y up, z behind (GL), forward w = -z
      const w = m.near * 1.5 + i * 37, x = (i % 7 - 3) * w * 0.05, y = (i % 5 - 2) * w * 0.04;
      const cz = m.proj[10] * -w + m.proj[14], cw = w;
      const dz = (cz / cw + 1) / 2;   // the depth buffer's 0..1
      const back = RECONSTRUCT.dist(dz, k.A, k.B);
      const ndcX = m.proj[0] * x / w, ndcY = m.proj[5] * y / w;
      const v = RECONSTRUCT.view(ndcX, ndcY, back, k.fxn, k.fyn, k.cy0);
      worst = Math.max(worst, Math.abs(back - w) / w, Math.abs(v[0] - x) / w, Math.abs(v[1] - y) / w);
    }
  }
  check('occlusion: depth reads back through the perspective constants', worst < 1e-6, worst.toExponential(2));
  // The lens: nothing blurs at its focus, the blur grows away from it and is capped.
  check('lens: sharp at the focus', cocOf(400, 400, 12000) === 0);
  check('lens: softer the further behind', cocOf(800, 400, 12000) > cocOf(500, 400, 12000) && cocOf(500, 400, 12000) > 0);
  check('lens: capped', cocOf(1e9, 1, 1e9) === DOF_MAX);
}

console.log(`ballpark-smoke: ${passes}/${passes + failures} passed · park ${Math.round(baseTris)} triangles, built in ${ms.toFixed(0)} ms`);
process.exit(failures ? 1 : 0);
