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
//      their lamps. The outer wall faces out along the whole outline at the heights it's
//      given, and the sign for the park's name hangs outside it behind home plate.
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
//   6. THE PLAYERS. Every pose builds, both hands, finite and inside its budget; a mirrored pose
//      is its original in a mirror; the cast puts everyone where the payload has them; every
//      player's face pick is the same twice and never a makeup layout; every cap, helmet and
//      mask clears the brow and the ears and leaves both eyes open.
//   7. THE GRAPHICS. diamond/hud.js lays out the arcade package on the wall TV's sub-screen, the
//      tablet's and the sandbox's, with and without the tube glass: everything inside the frame
//      (inside the title-safe area behind the glass), no word below the floor or cut short for
//      the script's longest names, no panel over another, the zone over the plate with a pitch
//      inside it or out, the tube's bulge undone, the numbers written as a scoreboard writes
//      them, every mark painted, a card animated in, and no league named in the engine file.
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
const PM = await import(P + 'gl/ballplayer-mesh.js');
const { castOf, castKey, bodyKey, leadOff } = await import(P + 'diamond/cast.js');
const { FACE } = await import(P + 'actor-head.js');
const { FACE_LAYOUTS } = await import(P + 'actor-faces.js');
const { MASK_BARS, nicknameOf } = await import(P + 'diamond/kits.js');
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
// triangles and 5,100 fans with its outer wall; these leave room for the dugouts.
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
{
  // the outer wall: a face along every edge of the outline, facing out, at the heights it's given
  const b = base.opaque.get('exterior'), heights = new Set();
  let faces = 0, inward = 0, len = 0, per = 0;
  for (let v = 0; v < b.n; v += 6) {
    const o = v * M.STRIDE, q = o + M.STRIDE, top = b.data[o + 2 * M.STRIDE + 1];
    const mid = [(b.data[o] + b.data[q]) / 2, 0, (b.data[o + 2] + b.data[q + 2]) / 2], n = [b.data[o + 3], 0, b.data[o + 5]];
    faces++; heights.add(top); len += Math.hypot(b.data[q] - b.data[o], b.data[q + 2] - b.data[o + 2]);
    if (G.insideOutline(base.outline, [mid[0] + n[0] * 2, 0, mid[2] + n[2] * 2]) || !G.insideOutline(base.outline, [mid[0] - n[0] * 2, 0, mid[2] - n[2] * 2])) inward++;
  }
  for (let i = 0; i < base.outline.length; i++) { const a = base.outline[i], c = base.outline[(i + 1) % base.outline.length]; per += Math.hypot(c[0] - a[0], c[2] - a[2]); }
  check('defaults: the outer wall faces out all round', faces > 50 && inward === 0 && Math.abs(len - per) < 0.5, `${inward} of ${faces} face in; ${len.toFixed(0)} ft of a ${per.toFixed(0)} ft outline`);
  const H = M.EXTERIOR_H;
  check('defaults: the outer wall at its four heights', [...heights].every((h) => [H.stand, H.line, H.outfield, H.eye].includes(h)) && heights.has(H.stand) && heights.has(H.outfield) && heights.has(H.eye), [...heights].join(','));
  check('defaults: the grandstand\'s wall behind the plate, the batter\'s eye\'s in centre', M.exteriorHeight([0, 0, -192]) === H.stand && M.exteriorHeight([0, 0, G.fenceDistance(0, base.field.fence) + 12]) === H.eye);
  const { c } = M.PARK_SIGN;
  check('defaults: the sign hangs outside the wall behind the plate', base.sign.n === 6 && c[2] < 0 && !G.insideOutline(base.outline, c) && G.insideOutline(base.outline, c, 8) && base.sign.data[5] === -1);
}

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

// ── 6. the players ───────────────────────────────────────────────────────────
{
  const KNOWNP = new Set(Object.values(M.MAT));
  let worstTris = 0;
  for (const name of Object.keys(PM.POSES)) for (const mirror of [false, true]) {
    const G = PM.createPlayerSet();
    const pose = Object.assign(mirror ? PM.mirrorPose(PM.POSES[name]()) : PM.POSES[name](), { at: [0, 0, 20], yaw: 0 });
    const role = name === 'catcher' ? 'catcher' : name === 'umpire' ? 'ump' : 'fielder';
    const look = PM.lookOf({ id: `gate:${name}:${mirror}`, side: mirror ? 'away' : 'home', role, slot: 3, headIndex: 3, glove: mirror ? 'R' : 'L', helmet: /^bat|ondeck|runner/.test(name), flapSide: mirror ? -1 : 1, mask: name === 'umpire' });
    PM.buildPlayer(G, pose, look);
    let tris = 0, bad = 0, badMat = 0, low = Infinity;
    for (const [, b] of G.batches) {
      tris += b.n / 3;
      for (let v = 0; v < b.n; v++) {
        const o = v * M.STRIDE;
        for (let k = 0; k < M.STRIDE; k++) if (!Number.isFinite(b.data[o + k])) bad++;
        if (!KNOWNP.has(b.data[o + 11])) badMat++;
        low = Math.min(low, b.data[o + 1]);
      }
    }
    worstTris = Math.max(worstTris, tris);
    const tag = `player ${name}${mirror ? ' (mirrored)' : ''}`;
    check(`${tag}: every float finite, every material known`, bad === 0 && badMat === 0, `${bad}/${badMat}`);
    check(`${tag}: inside 17,000 triangles`, tris > 4000 && tris <= 17000, `${tris}`);
    check(`${tag}: one head, in its slot`, G.heads.length === 1);
    // standing on the ground: nothing far under it, and the soles not hovering
    check(`${tag}: on the ground`, low > -0.12 && low < 0.45, low.toFixed(3));
  }
  // a mirrored pose is the original in a mirror: every joint's x negated, left for right
  const JOINTS = ['pelvis', 'spine', 'chest', 'neck', 'head', 'shL', 'shR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR', 'toeL', 'toeR', 'elL', 'elR', 'wrL', 'wrR', 'handL', 'handR'];
  for (const name of Object.keys(PM.POSES)) {
    const a = PM.solvePose(Object.assign(PM.POSES[name](), { at: [0, 0, 20], yaw: 0 })).J;
    const b = PM.solvePose(Object.assign(PM.mirrorPose(PM.POSES[name]()), { at: [0, 0, 20], yaw: 0 })).J;
    let worst = 0;
    for (const k of JOINTS) {
      const k2 = k.endsWith('L') ? k.slice(0, -1) + 'R' : k.endsWith('R') ? k.slice(0, -1) + 'L' : k;
      worst = Math.max(worst, Math.abs(a[k][0] + b[k2][0]), Math.abs(a[k][1] - b[k2][1]), Math.abs(a[k][2] - b[k2][2]));
    }
    check(`pose ${name}: its mirror is the same pose for the other hand`, worst < 1e-6, worst.toExponential(2));
  }
  // the cast: a lefty at the plate in the bottom half, men on first and third, a lefty pitching
  const p = { half: 'bottom', battingTeam: 'Kings', fieldingTeam: 'Rats', pitcher: 'Quist', throws: 'L', batter: 'Voss', bats: 'L',
    basesBefore: [true, false, true], moves: [{ from: 3, to: 4, name: 'Halvorsen' }, { from: 1, to: 2 }, { from: 0, to: 1 }] };
  const cast = castOf(p);
  const by = (id) => cast.find((c) => c.id === id);
  check('cast: nine fielders, the batter, two runners, on deck, two coaches, four umpires', cast.length === 19, `${cast.length}`);
  check('cast: every slot its own', new Set(cast.map((c) => c.look.slot)).size === cast.length);
  check('cast: the batting side wears home, the fielding side away, in the bottom half', by('Voss').look.side === 'home' && by('Quist').look.side === 'away');
  check('cast: a left-handed batter stands in the first-base box, mirrored', by('Voss').at[0] < 0 && by('Voss').mirror);
  check('cast: a left-handed pitcher is mirrored with his glove on the right', by('Quist').mirror && by('Quist').look.glove === 'R');
  check('cast: the man on third is named from the play', !!by('Halvorsen') && by('Halvorsen').at[0] > 50);
  check('cast: the man on first leads off toward second', (() => { const r = cast.find((c) => c.look.role === 'runner' && c.at[0] < 0); return r && Math.hypot(r.at[0] - leadOff(1)[0], r.at[2] - leadOff(1)[2]) < 1e-9; })());
  check('cast: the same payload, the same bodies', castOf(p).map(castKey).join() === cast.map(castKey).join());
  const next = castOf({ ...p, batter: 'Okafor', bats: 'R' });
  const rebuilt = next.filter((c, i) => bodyKey(c) !== bodyKey(cast[i])).map((c) => c.look.role);
  check('cast: a new batter rebuilds the batter and nobody else', rebuilt.length === 1 && rebuilt[0] === 'batter', rebuilt.join());
  // The fielders shade to the hitter's pull side (diamond/play.js fieldSpots), where the server's
  // plays start them: a hitter from the other side moves the seven of them over, and nobody else.
  const moved = next.filter((c, i) => castKey(c) !== castKey(cast[i])).map((c) => c.look.role);
  check('cast: a hitter from the other side moves the fielders over, and nobody else',
    moved.filter((r) => r === 'fielder').length === 7 && moved.every((r) => r === 'fielder' || r === 'batter'), moved.join());
  const ss = (q) => q.find((c) => c.id.endsWith(':SS'));
  check('cast: the shortstop shades toward third for a right-handed hitter', ss(next).at[0] > ss(cast).at[0], `${ss(cast).at[0].toFixed(1)} to ${ss(next).at[0].toFixed(1)}`);
  const sameSide = castOf({ ...p, batter: 'Okafor' }).filter((c, i) => castKey(c) !== castKey(cast[i])).map((c) => c.look.role);
  check('cast: a new hitter from the same side moves nobody', sameSide.length === 1 && sameSide[0] === 'batter', sameSide.join());
  check('cast: a half-inning break has no batter', !castOf({ ...p, phase: 'half' }).some((c) => c.look.role === 'batter'));
  // a skinned body is who he is and what he wears: a new batter is one new body, and a runner who
  // moves up keeps his
  const keysOf = (q) => new Set(castOf(q).map(bodyKey));
  const before = keysOf(p), newBatter = [...keysOf({ ...p, batter: 'Okafor', bats: 'R' })].filter((k) => !before.has(k));
  check('cast: a new batter is one new body', newBatter.length === 1 && JSON.parse(newBatter[0])[0] === 'Okafor', newBatter.join(' '));
  const onFirst = castOf({ ...p, basesBefore: [true, false, false], moves: [{ from: 1, to: 2, name: 'Halvorsen' }] }).find((c) => c.id === 'Halvorsen');
  const onSecond = castOf({ ...p, basesBefore: [false, true, false], moves: [{ from: 2, to: 3, name: 'Halvorsen' }] }).find((c) => c.id === 'Halvorsen');
  check('cast: a runner keeps his body from bag to bag', onFirst && onSecond && bodyKey(onFirst) === bodyKey(onSecond) && onFirst.look.slot !== onSecond.look.slot);
  check('kits: a club wears its nickname', nicknameOf('Precinct 9 Enforcers') === 'Enforcers');
  // faces: the same twice, never a makeup layout, and no ballplayer past forty
  let unstable = 0, makeup = 0, old = 0;
  for (let i = 0; i < 300; i++) {
    const role = i % 7 === 0 ? 'ump' : 'fielder';
    const look = PM.lookOf({ id: `face${i}`, role });
    const f1 = PM.faceFor(look), f2 = PM.faceFor(PM.lookOf({ id: `face${i}`, role }));
    if (JSON.stringify(f1) !== JSON.stringify(f2)) unstable++;
    if (FACE_LAYOUTS[f1.layout].makeup) makeup++;
    if (role !== 'ump' && FACE_LAYOUTS[f1.layout].age > 0.7) old++;
  }
  check('faces: the same pick twice', unstable === 0, `${unstable}`);
  check('faces: never a makeup layout', makeup === 0, `${makeup}`);
  check('faces: no ballplayer past forty', old === 0, `${old}`);
  // headwear, in the head's bind space (metres): the bands stay above the brow over the eyes and
  // above the ears, and the bills' tips stay above the eyes
  // The ear (actor-head.js addEar) sits at 1.62 m, 3.2 cm tall above it, from about 1.44 to 1.92
  // radians round the head; its top edge curves down toward its front and back.
  const earTop = (a) => { const t = (Math.abs(a) - 1.68) / 0.24; return Math.abs(t) >= 1 ? 1.62 : 1.62 + 0.032 * Math.sqrt(1 - t * t); };
  const eyeA = Math.atan2(FACE.eyeX, 0.09);
  let capLow = Infinity, capEar = Infinity;
  for (let a = -eyeA - 0.25; a <= eyeA + 0.25; a += 0.01) capLow = Math.min(capLow, PM.capBand(a));
  for (let a = 1.44; a <= 1.92; a += 0.01) capEar = Math.min(capEar, PM.capBand(a) - earTop(a), PM.capBand(-a) - earTop(a));
  check('cap: the band clears the brow', capLow >= FACE.browY + 0.015, capLow.toFixed(4));
  check('cap: the band clears the ears', capEar >= 0, `${(capEar * 1000).toFixed(1)} mm`);
  check('cap: the bill leaves the eyes open', PM.capBand(0) - PM.BILL_DROP.cap >= FACE.eyeY + 0.02);
  for (const flap of [1, -1]) {
    const band = PM.helmetBand(flap);
    let low = Infinity, open = Infinity;
    for (let a = -eyeA - 0.25; a <= eyeA + 0.25; a += 0.01) low = Math.min(low, band(a));
    for (let a = 1.44; a <= 1.92; a += 0.01) open = Math.min(open, band(-flap * a) - earTop(a));
    check(`helmet (flap ${flap > 0 ? 'left' : 'right'}): the band clears the brow`, low >= FACE.browY + 0.01, low.toFixed(4));
    check(`helmet (flap ${flap > 0 ? 'left' : 'right'}): the open side clears the ear`, open >= 0, `${(open * 1000).toFixed(1)} mm`);
    check(`helmet (flap ${flap > 0 ? 'left' : 'right'}): the bill leaves the eyes open`, band(0) - PM.BILL_DROP.helmet >= FACE.eyeY + 0.02);
  }
  // the mask's crossbars miss the eye line, a pupil's width either side
  const v = (PM.MASK_SPAN[0] - FACE.eyeY) / (PM.MASK_SPAN[0] - PM.MASK_SPAN[1]) * MASK_BARS.size;
  let near = Infinity;
  for (let y = MASK_BARS.rows[0]; y < MASK_BARS.size; y += MASK_BARS.rows[1]) near = Math.min(near, Math.abs(y - v));
  check('mask: the crossbars miss the eyes', near > MASK_BARS.width / 2 + 6, `${near.toFixed(1)} texels`);
  console.log(`  · players: the heaviest pose ${worstTris} triangles`);
}

// ── 7. the graphics ──────────────────────────────────────────────────────────
{
  const H = await import(P + 'diamond/hud.js');
  const { readFileSync } = await import('node:fs');
  // the wall TV's sub-screen, the tablet's (and a phone's), and the sandbox's biggest
  const SCREENS = [['wall TV', 730, 328], ['tablet', 330, 160], ['sandbox', 1180, 885]];
  // the script's longest names (data/scripts/baseball.bsm)
  const MAN = '"Wheels" McGraw', CLUB = 'Coldwater Kingfishers', CLUB2 = 'Precinct 9 Enforcers';
  const batRows = Array.from({ length: 5 }, (_, i) => ({ name: i ? `Halvorsen ${i}` : MAN, team: i % 2 ? CLUB : CLUB2, hr: 31 - i, rbi: 88 - i, avg: 0.331 - i / 100, sb: 41 - i }));
  const armRows = Array.from({ length: 5 }, (_, i) => ({ name: i ? `Okafor ${i}` : MAN, team: i % 2 ? CLUB : CLUB2, w: 14 - i, l: 6 + i, era: 2.81 + i / 10, k: 201 - i }));
  const base = {
    score: { away: 'CK', home: 'P9E', aScore: 12, hScore: 10, half: 'bottom', inning: 11, bases: [true, true, true], awayTeam: CLUB, homeTeam: CLUB2 },
    count: { balls: 3, strikes: 2, outs: 2 }, pitch: { velo: 101, type: 'Four-Seam Fastball', x: 0.5, y: 0.5, result: 'called' }, zone: true, bats: 'R',
  };
  const STATES = {
    'at-bat': { ...base, matchup: { batter: MAN, pitcher: MAN, bNum: 27, pNum: 31, bl: [612, 188, 44, 131, 41], pl: [14, 6, 612, 61, 201], batTeam: CLUB, pitchTeam: CLUB2 } },
    steal: { ...base, steal: { kind: 'caughtstealing', runner: MAN, num: 9, sb: 13, plate: 1.42, pop: 2.09, base: 3, team: CLUB } },
    splash: { ...base, splash: { kind: 'grandslam', word: 'GRAND SLAM', sub: `${MAN} · ${CLUB}` } },
    'the final': { ...base, gold: true, splash: { kind: 'walkoff', word: 'WALK-OFF!', sub: `${MAN} · ${CLUB}` } },
    'the leaders': { ...base, leaders: { race: 'hr', rows: batRows, season: 12, foot: `${CLUB} 12  ·  ${CLUB2} 10  ·  BOTTOM OF THE 11TH` } },
    'the strikeouts': { ...base, leaders: { race: 'k', rows: armRows, season: 12, foot: `TONIGHT  ·  ${CLUB} AT ${CLUB2}` } },
  };
  // a mark's box, the words measured the way a face sets capitals (FACE_ADVANCE)
  const wordW = (m, size) => String(m.s).length * H.FACE_ADVANCE[m.face] * size + Math.abs(m.skew ?? 0.2) * size * 0.75;
  const fitted = (m) => { const w = wordW(m, m.size); return !m.maxW || w <= m.maxW ? m.size : Math.max(m.min, m.size * m.maxW / w); };
  function boxOf(m) {
    switch (m.t) {
      case 'panel': case 'chip': case 'band': case 'box': return [m.x, m.y, m.x + m.w, m.y + m.h];
      case 'text': {
        const size = fitted(m), w = Math.min(wordW(m, size), m.maxW || Infinity);
        const x0 = m.align === 'center' ? m.x - w / 2 : m.align === 'right' ? m.x - w : m.x;
        return [x0, m.y - size * 0.8, x0 + w, m.y + size * 0.2];
      }
      case 'bulb': case 'bag': case 'disc': case 'burst': return [m.x - m.r, m.y - m.r, m.x + m.r, m.y + m.r];
      case 'rule': return [m.x1, m.y, m.x2, m.y + m.width];
      default: return null;   // the zone, its mark, the veil and the rays belong to the picture
    }
  }
  const overlap = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.5 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.5;
  const PERSIST = new Set(['score', 'count', 'speed', 'bug']);
  for (const [sname, w, h] of SCREENS) for (const safe of [false, true]) for (const [st, state] of Object.entries(STATES)) {
    const where = `${sname}${safe ? ' behind the glass' : ''}, ${st}`;
    const L = H.layoutHud(state, w, h, { theme: { bug: 'KSAB' }, safe, project: (p) => C.project('bat', w, h, p) });
    const [x0, y0, x1, y1] = safe ? [w * 0.05, h * 0.05, w * 0.95, h * 0.95] : [0, 0, w, h];
    const out = [], small = [], cut = [];
    for (const m of L.marks) {
      const b = boxOf(m);
      if (b && (b[0] < x0 - 0.5 || b[1] < y0 - 0.5 || b[2] > x1 + 0.5 || b[3] > y1 + 0.5)) out.push(`${m.t}:${m.g}${m.s ? ` '${m.s}'` : ''}`);
      if (m.t === 'text') {
        if (m.min < H.TEXT_FLOOR || m.size < H.TEXT_FLOOR) small.push(`'${m.s}' ${m.min.toFixed(1)}px`);
        if (m.maxW && wordW(m, m.min) > m.maxW + 0.5) cut.push(`'${m.s}' ${wordW(m, m.min).toFixed(0)}/${m.maxW.toFixed(0)}`);
      }
    }
    check(`graphics (${where}): inside the ${safe ? 'title-safe area' : 'frame'}`, !out.length, out.slice(0, 4).join(', '));
    check(`graphics (${where}): no word under the floor`, !small.length, small.slice(0, 3).join(', '));
    check(`graphics (${where}): the longest names fit without cutting`, !cut.length, cut.slice(0, 3).join(', '));
    // the panels that stay up don't cover each other, and a card covers none of them
    const panels = L.marks.filter((m) => m.t === 'panel' || m.t === 'box').map((m) => ({ g: m.g, b: boxOf(m) }));
    const hit = [];
    for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i], c = panels[j];
      if (a.g === c.g || (!PERSIST.has(a.g) && !PERSIST.has(c.g))) continue;
      if (overlap(a.b, c.b)) hit.push(`${a.g}/${c.g}`);
    }
    check(`graphics (${where}): no panel over another`, !hit.length, hit.join(', '));
    if (st === 'the leaders' || st === 'the strikeouts') {
      const words = L.marks.filter((m) => m.t === 'text' && m.g === 'table').map((m) => m.s);
      check(`graphics (${where}): the table has its five and its lit column`, words.includes('5') && words.some((s) => s.endsWith('▼')) && !L.marks.some((m) => m.g === 'score'), words.slice(0, 6).join(' '));
    }
  }
  // The zone over the plate in the batting view, and a pitch in it or out of it.
  {
    const w = 730, h = 328, proj = (p) => C.project('bat', w, h, p);
    const L = H.layoutHud(base, w, h, { project: proj });
    const zone = L.marks.find((m) => m.t === 'zone'), mark = L.marks.find((m) => m.t === 'mark');
    const xs = zone ? zone.pts.map((q) => q[0]) : [], ys = zone ? zone.pts.map((q) => q[1]) : [];
    check('zone: over the plate, in the lower middle of the batting view',
      !!zone && Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - w / 2) < 3 && Math.min(...ys) > h * 0.6 && Math.max(...ys) < h, zone && zone.pts.map((q) => q.map(Math.round).join(',')).join(' '));
    const inZone = (pt) => pt.x > Math.min(...xs) && pt.x < Math.max(...xs) && pt.y > Math.min(...ys) && pt.y < Math.max(...ys);
    check('zone: a pitch down the middle marks inside it', !!mark && inZone(mark));
    const wide = proj(H.pitchPoint({ x: 0.1, y: 0.5, result: 'ball' }));
    check('zone: a pitch well off the plate marks outside it', !!wide && !inZone(wide));
    // the 2-D plot's zone edges land on the zone's
    const edge = H.pitchPoint({ x: 0.25, y: 0.22 });
    check('zone: the plot\'s zone corner is the zone\'s corner (the catcher\'s left is +x)', Math.abs(edge[0] - H.ZONE.half) < 1e-9 && Math.abs(edge[1] - H.ZONE.high) < 1e-9, edge.join(','));
    const hbpR = H.pitchPoint({ x: 0.96, y: 0.5, result: 'hbp' }, 'R'), hbpL = H.pitchPoint({ x: 0.04, y: 0.5, result: 'hbp' }, 'L');
    check('zone: a pitch that hits him is on his side of the plate', hbpR[0] > H.ZONE.half && hbpL[0] < -H.ZONE.half, `${hbpR[0].toFixed(2)} ${hbpL[0].toFixed(2)}`);
    // behind the glass the zone follows the picture: the tube's bulge undone
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      const pt = { x: (i * 37) % w, y: (i * 53) % h }, q = H.throughTube(pt, w, h);
      const dx = q.x / w - 0.5, dy = q.y / h - 0.5, k = 1 + (dx * dx + dy * dy) * 0.05;
      worst = Math.max(worst, Math.abs((0.5 + dx * k) * w - pt.x), Math.abs((0.5 + dy * k) * h - pt.y));
    }
    check('zone: through the tube, the bulge undone', worst < 1e-3, worst.toExponential(2));
  }
  // A card the broadcast throws shows whatever else is up: over the leaders' table (extra
  // innings at a break), and before the game has a score (the pre-game matchup).
  {
    const sp = { kind: 'extras', word: 'EXTRA INNINGS', sub: '10th' };
    const over = H.layoutHud({ ...STATES['the leaders'], splash: sp }, 730, 328, {});
    const groups = over.marks.map((m) => m.g);
    check('graphics: a splash goes over the leaders\' table', groups.includes('table') && groups.lastIndexOf('splash') > groups.lastIndexOf('table'));
    const alone = H.layoutHud({ splash: { kind: 'matchup', word: 'DEADBALL', sub: 'Rats vs Kings' } }, 730, 328, { theme: { bug: 'KSAB' } });
    const words = alone.marks.filter((m) => m.t === 'text').map((m) => m.s);
    check('graphics: a card before the first pitch is all there is, in the theme\'s word', [...new Set(alone.marks.map((m) => m.g))].join(',') === 'bug,splash' && words.includes('PLAY BALL!'), words.join(' | '));
  }
  // the numbers as a scoreboard writes them
  check('numbers: an average', H.fmtAvg(60, 212) === '.283' && H.fmtAvg(3, 3) === '1.000' && H.fmtAvg(0, 0) === '.000', H.fmtAvg(60, 212));
  check('numbers: an ERA, and dashes before an out', H.fmtEra(20, 186) === '2.90' && H.fmtEra(0, 0) === '-.--', H.fmtEra(20, 186));
  check('numbers: the matchup lines', H.batLine([212, 60, 8, 22, 3]) === '.283   8 HR   22 RBI' && H.armLine([5, 2, 186, 20, 44]) === '5–2   2.90 ERA   44 K', H.armLine([5, 2, 186, 20, 44]));
  // every kind of card the grandstand puts up has its words
  const W = H.HUD_THEME.words;
  check('theme: a word for every splash and steal', ['homerun', 'grandslam', 'walkoff', 'doubleplay', 'tripleplay', 'extras', 'gamewin', 'champion', 'matchup', 'steal', 'caughtstealing', 'doublesteal', 'strikeout', 'walk'].every((k) => W[k]));
  // the painter runs every mark, and a card comes in and settles on the hand-cranked clock
  {
    const cv = document.createElement('canvas');
    const hud = H.createHud(cv, { theme: { bug: 'KSAB' }, project: (p, w, h) => C.project('bat', w, h, p), safe: () => true, motion: () => true });
    let threw = null;
    try {
      for (const state of Object.values(STATES)) { hud.set(state); stub.runFrames(30); }
    } catch (e) { threw = e.message; }
    check('graphics: every mark paints', !threw, threw);
    const kinds = new Set();
    for (const state of Object.values(STATES)) for (const m of H.layoutHud(state, 730, 328, { project: (p) => C.project('bat', 730, 328, p), theme: { bug: 'KSAB' } }).marks) kinds.add(m.t);
    check('graphics: the states between them use every kind of mark', ['panel', 'text', 'bulb', 'chip', 'bag', 'zone', 'mark', 'burst', 'disc', 'rays', 'veil', 'band', 'rule', 'box'].every((k) => kinds.has(k)), [...kinds].join(','));
    hud.set(STATES['at-bat']);
    stub.runFrames(30);
    check('graphics: a card animates in and the loop stops', hud.layout.marks.some((m) => m.g === 'matchup'));
    hud.dispose();
  }
  // the engine file names no league, club or network: those ride in with a theme
  const src = readFileSync(new URL(P + 'diamond/hud.js', import.meta.url), 'utf8').replace(/deadball-glass2\.md/g, '');
  check('graphics: hud.js names no league, club or network', !/deadball|ksab|coldwater|kingfisher/i.test(src), (src.match(/deadball|ksab|coldwater|kingfisher/i) || [])[0]);
}

console.log(`ballpark-smoke: ${passes}/${passes + failures} passed · park ${Math.round(baseTris)} triangles, built in ${ms.toFixed(0)} ms`);
process.exit(failures ? 1 : 0);
