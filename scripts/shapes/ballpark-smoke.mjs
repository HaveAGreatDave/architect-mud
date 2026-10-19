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
//      their lamps. The bowl round it is the map's Coliseum (glass/models/coliseum.js): the
//      outline its square on the foul lines, the wall facing out on all four sides and in over
//      the stands, a tower at each corner, the name plate on the main gate across from home on
//      Sorrel Way. The roof's three shells cover the bowl shut and nest open, clear each other,
//      and spring from the rails; the lights cross from the towers to the decks with no jump;
//      the roof's travel eases over the map's ninety seconds; and the plates letter his name
//      over COLISEUM, raised and never squeezed.
//   2. THE MATRICES AGREE WITH THE PINHOLE. camera.js writes each shot out as GL matrices
//      and works the same shot out from the camera's own axes. If they drift, the director
//      (which frames with `project`) and the picture disagree about what's in shot. Every
//      shot, three screen shapes, 300 points each, to a hundredth of a pixel.
//   3. THE BOARD SAYS THE GAME. The scoreboard's lamps carry the line score, the count and
//      the names, the latest nine innings in extras, and an E only for a game that counts
//      errors.
//   4. THE FALLBACK HOLDS, and the dirt. The dirt is where paintInfield paints it (diamond/dirt.js
//      onDirt), and each mark the game leaves paints inside the rect that goes up to the GPU; the
//      grounds crew's drag copies the painted dirt back inside its polygon only, and a drag mat
//      and its ropes build finite, lying on the dirt and reaching the men pulling it.
//      With the flag off the view IS the 2-D Gameday. Forced on with no
//      WebGL2, `createBallparkRenderer` returns null rather than throwing, the view gives way
//      to the 2-D Gameday, and the booth's held line still lands with the play.
//   5. THE LIGHT AND THE LENS. Each casting tower's shadow map holds the shot's shadow sphere;
//      the occlusion reads depth back through the perspective's constants to where it was; the
//      lens is sharp at its focus and softer away from it. The sky on the clock (diamond/sky.js) is
//      the night the park was tuned at from 20:00, brighter back toward sunset and never past its
//      cap, the windows, the buildings' own lights and the stars coming on as it darkens, the warm
//      horizon in the west whichever way the park faces, and the shared keyframes' first and last
//      rows the same. The weather (diamond/weather.js): every word a look, a clear night the tuned
//      night still, rain wet and hazy with the stars gone, the bolts the same twice and as many a
//      minute as the weather says, out past the outfield, and a bolt's ribbon finite and standing
//      on the ground.
//   6. THE PLAYERS. Every pose builds, both hands, finite and inside its budget; a mirrored pose
//      is its original in a mirror; the cast puts everyone where the payload has them, the
//      grounds crew in their work clothes in the middle of the fifth and clear of the umpires; every
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
const { paintInfield, paintMark, markRect, onDirt, polyRect, smoothPoly, DIRT_RECT } = await import(P + 'diamond/dirt.js');
const { createBallparkRenderer } = await import(P + 'gl/ballpark.js');
const { spotMatrix, spotReach } = await import(P + 'gl/spotshadow.js');
const { ssaoConstants, RECONSTRUCT } = await import(P + 'gl/ssao.js');
const { cocOf, DOF_MAX } = await import(P + 'gl/broadcast.js');
const PM = await import(P + 'gl/ballplayer-mesh.js');
const { castOf, castKey, bodyKey, leadOff, crewDue, CREW_HOLD } = await import(P + 'diamond/cast.js');
const { FACE } = await import(P + 'actor-head.js');
const { FACE_LAYOUTS } = await import(P + 'actor-faces.js');
const { MASK_BARS, nicknameOf, paintKitAtlas, paintLogos, kitsFor } = await import(P + 'diamond/kits.js');
const { setClubs } = await import(P + 'club-crest.js');
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
  // the bowl: the Coliseum's square on the foul lines, as the map draws it, a wall on each side of
  // it facing out, between the plinth and the frieze
  const b = base.opaque.get('exterior'), heights = new Set();
  const { BOWL } = G, n = -BOWL.near, f = BOWL.far;
  const edgeD = (p) => Math.min(...base.outline.map((a, i) => { const c = base.outline[(i + 1) % base.outline.length], ab = [c[0] - a[0], c[2] - a[2]], ap = [p[0] - a[0], p[2] - a[2]], t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1]))); return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t); }));
  check('defaults: the outline is the bowl\'s square on the foul lines', base.outline.length === 4 && [[n, n], [n, f], [f, f], [f, n]].every(([a, c], i) => { const q = G.sOf(base.outline[i]); return Math.abs(q[0] - a) < 1e-6 && Math.abs(q[1] - c) < 1e-6; }));
  // its outside on the outline and facing out, its inside the wall's thickness in and facing the stands
  let outer = 0, inner = 0, wrong = 0;
  for (let v = 0; v < b.n; v += 6) {
    const o = v * M.STRIDE, q = o + M.STRIDE;
    const mid = [(b.data[o] + b.data[q]) / 2, 0, (b.data[o + 2] + b.data[q + 2]) / 2], nn = [b.data[o + 3], 0, b.data[o + 5]];
    const out = !G.insideOutline(base.outline, [mid[0] + nn[0] * 30, 0, mid[2] + nn[2] * 30]);
    // (the north and south walls run two feet past the corners, over the east and west ones' ends)
    const d = edgeD(mid);
    for (let k = 0; k < 6; k++) heights.add(Math.round(b.data[o + k * M.STRIDE + 1] * 100) / 100);
    if (out && d <= 3) outer++; else if (!out && d > 10 && d < 20) inner++; else wrong++;
  }
  check('defaults: the bowl\'s wall faces out on all four sides, on the outline, and in over the stands', outer === 4 && inner === 4 && wrong === 0, `${outer} out, ${inner} in, ${wrong} wrong`);
  const Z = M.BOWL_Z;
  check('defaults: the wall stands from the plinth to the frieze', heights.size === 2 && heights.has(Math.round(Z.plinth * 100) / 100) && heights.has(Math.round(Z.wall * 100) / 100), [...heights].join(','));
  // the plates: the main gate's on Sorrel Way straight across from home plate, standing off the
  // frontispiece outside the wall and facing out, and the bleacher gate's on the boulevard
  const { c, n: sn } = M.PARK_SIGN, [s3, s1] = G.sOf(c);
  const signN = [base.sign.data[3], base.sign.data[4], base.sign.data[5]];
  check('defaults: the name plate hangs on the main gate, across from home on Sorrel Way, facing out', base.sign.n === 12 && Math.abs(s3) < 1 && s1 < n && s1 > n - 8 && !G.insideOutline(base.outline, c) && G.insideOutline(base.outline, c, 8)
    && signN.every((v, i) => Math.abs(v - sn[i]) < 1e-6) && sn[0] > 0 && sn[2] < 0, `s3 ${s3.toFixed(1)}, s1 ${s1.toFixed(1)}`);
  check('defaults: the plate is the map\'s, 0.47 by 0.14 tiles', Math.abs(M.PARK_SIGN.w / M.PARK_SIGN.h - (0.47 * (BOWL.near + BOWL.far) / 2.94) / (0.14 * 226)) < 1e-6);
  // the lights: a tower at each corner of the bowl with its lamps up in its lamp house and a place
  // under a deck for its light when the roof is shut, and a row under each deck
  const towers = base.field.towers.filter((T) => T.kind === 'tower'), decks = base.field.towers.filter((T) => T.kind === 'deck');
  const nearCorner = (T) => Math.min(...base.outline.map((p) => Math.hypot(p[0] - T.base[0], p[2] - T.base[2])));
  check('defaults: four towers at the corners and a lamp row under each deck', towers.length === 4 && decks.length === 2 && towers.every((T) => nearCorner(T) < 40 && G.insideOutline(base.outline, T.base) && T.lamp[1] > 170 && T.under && G.insideOutline(base.outline, T.under.lamp) && T.under.lamp[1] < M.BOWL_Z.corn),
    towers.map((T) => nearCorner(T).toFixed(0)).join(','));
  // the lamps, the beacons, the lanterns and the halo: whole triangles, finite, lit
  let lampBad = 0;
  for (const [k, lb] of Object.entries(base.lamps)) {
    if (!(lb.n > 0 && lb.n % 3 === 0)) lampBad++;
    for (let v = 0; v < lb.n; v++) { const o = v * M.STRIDE; for (let j = 0; j < M.STRIDE; j++) if (!Number.isFinite(lb.data[o + j])) lampBad++; if (lb.data[o + 11] !== M.MAT.EMISSIVE) lampBad++; }
    void k;
  }
  check('defaults: the lamps build, every one lit', lampBad === 0 && ['tower', 'deck', 'beacon', 'lantern', 'halo'].every((k) => base.lamps[k]?.n > 0), `${lampBad}`);
}

// ── the roof ─────────────────────────────────────────────────────────────────
// The map's three shells at the broadcast's size: the first fixed over the boulevard end, the other
// two riding the rails. Shut they cover the bowl from Sorrel Way to the boulevard, each lapping the
// next; open they nest under the first. At the crown and at mid-span each clears the one over it.
{
  const { BOWL } = G, kh = (BOWL.near + BOWL.far) / 2.94;
  const run = (i, p) => { const S = M.SHELLS[i], d = G.sOf(M.shellShift(i, p))[1]; return [G.fromBlock(S.shut + S.len) + d, G.fromBlock(S.shut) + d]; };
  const shut = [0, 1, 2].map((i) => run(i, 1)), open = [0, 1, 2].map((i) => run(i, 0));
  check('the roof: three shells, the first fixed', base.roof.length === 3 && base.roof[0].fixed && !base.roof[1].fixed && !base.roof[2].fixed);
  check('the roof: shut, the shells cover the bowl from Sorrel Way to the boulevard, each lapping the next',
    shut[2][0] <= -BOWL.near + 2 && shut[0][1] >= BOWL.far - 1 && shut[1][0] < shut[0][0] && shut[2][1] > shut[1][0] && shut[1][1] > shut[0][0], JSON.stringify(shut.map((r) => r.map((v) => +v.toFixed(0)))));
  // (the last is a little longer than the first, so its south end shows past it, as on the map)
  check('the roof: open, the two that travel nest under the first', [1, 2].every((i) => open[i][1] <= open[0][1] + 1e-6 && (Math.min(open[i][1], open[0][1]) - Math.max(open[i][0], open[0][0])) / (open[i][1] - open[i][0]) > 0.9), JSON.stringify(open.map((r) => r.map((v) => +v.toFixed(0)))));
  const zAt = (a, u) => { const P = a.pts; for (let k = 0; k < P.length - 1; k++) if (u >= P[k][0] && u <= P[k + 1][0]) return P[k][1] + (u - P[k][0]) / (P[k + 1][0] - P[k][0]) * (P[k + 1][1] - P[k][1]); return NaN; };
  const arch = M.SHELLS.map((S) => M.shellArch(S));
  const gaps = [0, 1].flatMap((i) => [0, M.SHELLS[i + 1].c / 2].map((u) => G.ftUp(zAt(arch[i], u) - zAt(arch[i + 1], u))));
  check('the roof: each shell clears the one over it by five to eight feet at the crown and mid-span', gaps.every((g) => g > 5 && g < 8), gaps.map((g) => g.toFixed(1)).join(', '));
  // the map's decks reach in to 1.13 tiles and the outer rail's step stands to 1.25
  check('the roof: the shells spring from the decks\' rails, each lower than the one over it', M.SHELLS.every((S, i) => S.c >= 1.13 && S.c <= 1.25 && G.ftUp(S.zs) >= M.BOWL_Z.corn - 1e-6 && (i === 0 || (S.zs < M.SHELLS[i - 1].zs && S.c < M.SHELLS[i - 1].c))), M.SHELLS.map((S) => (S.c * kh).toFixed(0)).join(', '));
  let bad = 0, badN = 0, badMat = 0, tris = 0;
  for (const r of base.roof) {
    const d = r.batch.data; tris += r.batch.n / 3;
    for (let v = 0; v < r.batch.n; v++) {
      const o = v * M.STRIDE;
      for (let k = 0; k < M.STRIDE; k++) if (!Number.isFinite(d[o + k])) bad++;
      if (Math.abs(Math.hypot(d[o + 3], d[o + 4], d[o + 5]) - 1) > 1e-3) badN++;
      if (![M.MAT.METAL, M.MAT.GLAZE, M.MAT.GILT, M.MAT.CONCRETE].includes(d[o + 11])) badMat++;
    }
  }
  check('the roof: every shell finite, its normals units, metal, glass, bronze and painted steel', bad === 0 && badN === 0 && badMat === 0 && tris > 1000 && tris < 5000, `${bad}/${badN}/${badMat}, ${tris} triangles`);
  // the lights go with it: open, the towers; shut, their light has gone over to the decks; and no
  // light moves while it's lit
  const T6 = base.field.towers;
  const L0 = M.roofLights(T6, 0), L1 = M.roofLights(T6, 1);
  check('the roof: open, the towers light the field; shut, the lamps under the decks do',
    T6.every((T, i) => (T.kind === 'deck' ? L0[i].k === 1 && L1[i].k === 1 : L0[i].k === 1 && L0[i].lamp === T.lamp && L1[i].k === 1 && L1[i].lamp === T.under.lamp)));
  let jumps = 0;
  for (let s = 0.01; s <= 1.0001; s += 0.01) {
    const a = M.roofLights(T6, s - 0.01), b = M.roofLights(T6, s);
    a.forEach((L, i) => { if (L.lamp !== b[i].lamp && (L.k > 0.03 || b[i].k > 0.03)) jumps++; });
  }
  check('the roof: no light jumps while it\'s lit', jumps === 0, `${jumps}`);
  // and the roof's travel: the first state heard is where it is; a change eases out of rest and in
  // again over the map's ninety seconds, from wherever it had got to
  const tr = M.roofTrack(90000);
  tr.set(true, 1000);
  const a0 = tr.at(1000);
  tr.set(false, 2000);
  const a1 = tr.at(2000), a2 = tr.at(2000 + 45000), a3 = tr.at(2000 + 90000), mv = tr.moving(2000 + 1000), still = !tr.moving(2000 + 90001);
  tr.set(true, 2000 + 120000); tr.set(false, 2000 + 165000);
  const back = tr.at(2000 + 165000);
  check('the roof: its travel starts where it is, eases over ninety seconds, and turns back from wherever it has got to',
    a0 === 1 && a1 === 1 && Math.abs(a2 - 0.5) < 1e-9 && a3 === 0 && mv && still && Math.abs(back - 0.5) < 1e-9 && tr.to === 0, [a0, a1, a2, a3, back].join(', '));
  tr.set(undefined, 999999);
  check('the roof: a payload with no roof leaves it where it is', tr.to === 0);
}

// ── the plates ───────────────────────────────────────────────────────────────
// His name goes on the main gate's plate the way the map letters it: his name over COLISEUM, each
// line in its own band, raised (a shadow, a highlight and the gilt face), never squeezed.
{
  const RB = await import(P + 'gl/ballpark.js');
  const calls = [];
  const rec = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === 'translate' ? (x, y) => { t.__x = (t.__x || 0) + x; t.__y = (t.__y || 0) + y; }
      : k === 'save' ? () => (t.__s ??= []).push([t.__x || 0, t.__y || 0]) : k === 'restore' ? () => { [t.__x, t.__y] = t.__s.pop(); } : k === 'measureText' ? (s) => ({ width: String(s).length * (parseFloat(t.font) || 10) * 0.7, actualBoundingBoxAscent: (parseFloat(t.font) || 10) * 0.7 })
      : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'fillText' ? (...a) => calls.push({ a: [a[0], a[1] + (t.__x || 0), a[2] + (t.__y || 0), ...a.slice(3)], font: t.font, fill: t.fillStyle }) : () => {}),
    set: (t, k, v) => { t[k] = v; return true; } }) }) };
  RB.paintPlateCanvas(rec, 'Charles B. Hughson Coliseum');
  const of = (s) => calls.filter((c) => c.a[0] === s);
  const A = M.PLATE_ATLAS, name = of('CHARLES B. HUGHSON'), col = of('COLISEUM'), bl = of('BLEACHERS');
  const inCell = (c, [x, y, w, h]) => c.a[1] > x && c.a[1] < x + w && c.a[2] > y && c.a[2] < y + h;
  check('the plates: his name over COLISEUM, as the map sets them', JSON.stringify(RB.plateLines('Charles B. Hughson Coliseum')) === '["CHARLES B. HUGHSON","COLISEUM"]');
  check('the plates: each line raised, a shadow, a highlight and its gilt face, in the deco hand', [name, col, bl].every((l) => l.length === 3 && l.every((c) => /Limelight/.test(c.font))), [name.length, col.length, bl.length].join(','));
  check('the plates: never squeezed to fit', calls.every((c) => c.a.length === 3), calls.filter((c) => c.a.length !== 3).map((c) => c.a[0]).join(', '));
  check('the plates: his name over COLISEUM on the main gate\'s, BLEACHERS on the bleacher gate\'s', name.every((c) => inCell(c, A.main)) && col.every((c) => inCell(c, A.main)) && bl.every((c) => inCell(c, A.bleach)) && name[2].a[2] < col[2].a[2]);
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
  check('third: the bag and the way in from second in frame', on('third', G.BAGS[3]) && on('third', [42.4, 0, 84.8]) && on('third', [21.2, 0, 106]));
  check('the plate: the plate and the last strides from third in frame', on('plate', [0, 0, 0]) && on('plate', [28.3, 0, 28.3]));
  check('the backstop: the plate and the ground in front of the backstop either side in frame', on('backstop', [0, 0, 0]) && on('backstop', [0, 0, -54]) && on('backstop', [17, 0, -52]) && on('backstop', [-17, 0, -52]));
  check('high home: all three bases in frame', [1, 2, 3].every((k) => on('high', G.BAGS[k])));
  // between at-bats (diamond/between.js): each on-deck circle with its hitter head to foot, the
  // pitcher off the back of the mound the same, and a stand of fans
  check('the on-deck cameras: each circle\'s hitter head to foot in frame', [['deck3', 31], ['deck1', -31]].every(([n, x]) => on(n, [x, 0.2, -9]) && on(n, [x, 6.3, -9])));
  check('the rub camera: the pitcher off the back of the mound head to foot in frame', on('rub', [0, 0.2, 70.4]) && on('rub', [0, 6.3, 70.4]));
  {
    const a = base.crowd.sit, n = a.length / M.CROWD_STRIDE;
    let seen = 0;
    for (let i = 0; i < a.length; i += M.CROWD_STRIDE) if (on('crowd', [a[i], a[i + 1] + 3, a[i + 2]])) seen++;
    check('the crowd camera: a stand of fans in frame', seen >= 150, `${seen} of ${n}`);
  }
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
  // the dirt: where it is, and the marks a game leaves on it, each inside the rect that goes up
  const dirt = { plate: [0, 0], mound: [0, 59.5], first: [-63.6, 63.6], second: [0, 127.3], third: [63.6, 63.6], 'the line to first': [-30, 30], 'behind second': [0, 145], 'the hole at short': [30, 120] };
  const grass = { 'the infield grass': [-25, 75], 'in front of the mound': [0, 30], 'the outfield': [0, 250], 'past the infield arc': [0, 160], 'foul ground': [-40, 10], 'behind the plate': [0, -20] };
  for (const [k, q] of Object.entries(dirt)) check(`the dirt: ${k} is dirt`, onDirt(q[0], q[1]));
  for (const [k, q] of Object.entries(grass)) check(`the dirt: ${k} isn't`, !onDirt(q[0], q[1]));
  const px = 2048, S = px / DIRT_RECT.size, T = (x, z) => [(x - DIRT_RECT.x0) * S, (z - DIRT_RECT.z0) * S];
  const holds = (r, x, z, reach) => { const [a, b] = T(x, z); return r[0] <= a - reach * S && r[1] <= b - reach * S && r[0] + r[2] >= a + reach * S && r[1] + r[3] >= b + reach * S; };
  const g = document.createElement('canvas').getContext('2d');
  for (const m of [{ kind: 'stride', at: [0.29, 56.04], dir: 180, seed: 1 }, { kind: 'dig', at: [2.98, -0.5], dir: -87, seed: 2 }, { kind: 'stride', at: [-127.9, -39.9], dir: 0, seed: 3 }]) {
    const r = markRect(m, px), inside = !!r && r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= px && r[1] + r[3] <= px;
    check(`the dirt: a ${m.kind}'s rect is inside the canvas and holds the mark (1.2 ft round it)`, inside && (m.at[0] < -127 || holds(r, m.at[0], m.at[1], 1.2)), JSON.stringify(r));
    check(`the dirt: a ${m.kind} paints inside its rect`, JSON.stringify(paintMark(g, m, px)) === JSON.stringify(r));
  }
  const scar = { kind: 'scar', pts: [[-2.7, 124.6], [-1.6, 125.7], [-0.4, 126.9], [1.3, 128.6]], w: 1.3, end: true, seed: 4 };
  const sr = markRect(scar, px);
  check('the dirt: a scar\'s rect holds its way and the heap ahead of it', !!sr && scar.pts.every((q) => holds(sr, q[0], q[1], scar.w / 2)) && holds(sr, 1.3 + 0.84 * 0.707, 128.6 + 0.84 * 0.707, 0.78), JSON.stringify(sr));
  check('the dirt: a mark off the canvas touches nothing', markRect({ kind: 'stride', at: [0, 400], dir: 0, seed: 5 }, px) === null);
  // the drag: the painted dirt copied back inside the polygon a mat went over, clipped to it, and
  // only its rect going up
  const poly = [[40.2, 118.6], [45.1, 121.9], [43.4, 124.5], [38.5, 121.2]], pr = polyRect(poly, px), calls = [];
  const rec = new Proxy({}, { get: (t, k) => (...a) => calls.push([k, a]), set: (t, k, val) => { calls.push(['=' + k, [val]]); return true; } });
  const src = { width: px, height: px }, got = smoothPoly(rec, src, poly, px), names = calls.map((c) => c[0]);
  const draw = calls.find((c) => c[0] === 'drawImage'), path = calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo');
  check('the dirt: the drag\'s rect holds its polygon and goes up', !!pr && JSON.stringify(got) === JSON.stringify(pr) && poly.every((q) => holds(pr, q[0], q[1], 0)), JSON.stringify(pr));
  check('the dirt: the drag copies the painted dirt back, clipped to its polygon', names.indexOf('clip') > 0 && names.indexOf('clip') < names.indexOf('drawImage') && calls.some((c) => c[0] === '=globalCompositeOperation' && c[1][0] === 'copy')
    && names[0] === 'save' && names[names.length - 1] === 'restore' && !!draw && draw[1][0] === src && JSON.stringify(draw[1].slice(1)) === JSON.stringify([...pr, ...pr])
    && path.length === 4 && path.every((c, i) => Math.abs(c[1][0] - T(...poly[i])[0]) < 1e-9 && Math.abs(c[1][1] - T(...poly[i])[1]) < 1e-9), names.join(' '));
  check('the dirt: a drag off the canvas touches nothing', polyRect([[0, 400], [6, 400], [6, 403], [0, 403]], px) === null && smoothPoly(rec, src, [[0, 400], [6, 400], [6, 403]], px) === null);
  // a drag mat and its ropes: finite, lying on the dirt where it says, the ropes up to the men
  const mb = M.createBatch(64), mat = { at: [44, 0, 121], yaw: -60, w: 6, l: 3, ropes: [[45, 3.9, 125], [42, 3.9, 127]] };
  const shoulder = [44.6, 4.95, 124.2], hands = [45.2, 4.0, 125.1];
  M.dragMat(mb, mat, [{ side: 1, shoulder, hands }, { side: -1, hands: mat.ropes[1] }]);
  let mbad = 0, low = Infinity, high = -Infinity, far = 0;
  const KNOWNM = new Set(Object.values(M.MAT));
  for (let k = 0; k < mb.n; k++) {
    const o = k * M.STRIDE;
    for (let j = 0; j < M.STRIDE; j++) if (!Number.isFinite(mb.data[o + j])) mbad++;
    if (!KNOWNM.has(mb.data[o + 11])) mbad++;
    low = Math.min(low, mb.data[o + 1]); high = Math.max(high, mb.data[o + 1]);
    far = Math.max(far, Math.hypot(mb.data[o] - mat.at[0], mb.data[o + 2] - mat.at[2]));
  }
  check('a drag mat: every float finite, every material known', mb.n > 0 && mbad === 0, `${mb.n} vertices, ${mbad} bad`);
  check('a drag mat: on the ground, its ropes up to the hands and over the shoulder', Math.abs(low) < 1e-6 && high > shoulder[1] && high < shoulder[1] + 0.1, `${low.toFixed(3)} to ${high.toFixed(3)}`);
  check('a drag mat: nothing further out than its men', far < Math.hypot(mat.at[0] - mat.ropes[1][0], mat.at[2] - mat.ropes[1][2]) + 0.2, far.toFixed(2));
  const cv = document.createElement('canvas');
  let r = 'threw';
  try { r = createBallparkRenderer(cv); } catch (e) { r = 'threw: ' + e.message; }
  check('no WebGL2: createBallparkRenderer returns null', r === null, String(r));

  // on by default; the flag set to '0' is the 2-D Gameday itself
  const store = new Map(), win = globalThis.window;
  win.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, x) => store.set(k, String(x)), removeItem: (k) => store.delete(k) };
  store.set('deadball.grandstand', '0');
  const h1 = stub.makeHost();
  const off = createGrandstandView(h1);
  check('flag \'0\': the view is the 2-D Gameday', typeof off.apply === 'function' && !('setShot' in off));
  store.delete('deadball.grandstand');
  const byDefault = createGrandstandView(stub.makeHost());
  check('no flag: the Grandstand, on by default', typeof byDefault.setShot === 'function');
  store.set('deadball.grandstand', '1');
  const optedIn = createGrandstandView(stub.makeHost());
  check('the flag set to \'1\', as the opt-in left it: still the Grandstand', typeof optedIn.setShot === 'function');
  byDefault.clear(); optedIn.clear();
  delete win.localStorage;

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

// the sky on Coldwater's clock
{
  const { NIGHT, DUSK, skyLook } = await import(P + 'diamond/sky.js');
  const { SKY } = await import('../../client/shared/sky-keys.js');
  const KEYS = ['up', 'dn', 'zen', 'hor', 'glow', 'fog', 'cityLit', 'pool', 'towers', 'fogDens', 'curtain', 'sign'];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const h of [null, 0, 2, 20, 21.5, 23.9]) {
    const L = skyLook(h);
    check(`the sky: at ${h ?? 'no hour'} it's the night the park was tuned at`, KEYS.every((k) => same(L[k], NIGHT[k])) && same(L.horAway, NIGHT.hor) && L.stars === 1, KEYS.filter((k) => !same(L[k], NIGHT[k])).join(', '));
  }
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const at = (h) => skyLook(h, { bearing: 315 });
  check('the sky: brighter back toward sunset', lum(at(18).zen) > lum(at(19).zen) && lum(at(19).zen) > lum(at(19.5).zen) && lum(at(19.5).zen) > lum(NIGHT.zen) && lum(at(18.5).hor) > lum(at(19).hor),
    [18, 19, 19.5].map((h) => lum(at(h).zen).toFixed(4)).join(' '));
  let worst = 0, bad = 0;
  for (let h = 0; h < 24; h += 0.25) {
    const L = at(h);
    for (const k of ['up', 'dn', 'zen', 'hor', 'horAway', 'fog']) {
      worst = Math.max(worst, lum(L[k]) / lum(NIGHT[k === 'horAway' ? 'hor' : k]));
      for (const v of L[k]) if (!(v >= 0) || !Number.isFinite(v)) bad++;
    }
    for (const k of ['cityLit', 'pool', 'stars', 'night']) if (!(L[k] >= 0) || !Number.isFinite(L[k])) bad++;
  }
  check('the sky: every value finite at every quarter hour, and never brighter than its cap', bad === 0 && worst <= DUSK.cap + 1e-9 && worst > 10, `${bad} bad, ${worst.toFixed(1)}x`);
  check('the sky: the windows and the lamps come on and the stars come out as it darkens', at(18).cityLit < at(19).cityLit && at(19).cityLit < at(20).cityLit && at(20).cityLit === NIGHT.cityLit
    && at(18).pool < at(20).pool && at(18.5).stars === 0 && at(20).stars === 1, [18, 19, 20].map((h) => at(h).cityLit.toFixed(2)).join(' '));
  check('the sky: the buildings\' own lights come on before the windows, and are full on at night', at(12).lights === 0 && at(18.5).lights > at(18.5).cityLit / NIGHT.cityLit
    && at(19).lights > at(18.5).lights && at(20).lights === 1 && skyLook(21).lights === 1, [12, 18.5, 19, 20].map((h) => at(h).lights.toFixed(2)).join(' '));
  // the sun goes down in the west: toward third and left field for a park that faces north-west, and
  // straight out along third's side for one that faces north
  const w315 = at(19).sun, w0 = skyLook(19, { bearing: 0 }).sun;
  check('the sky: the warm horizon is in the west, whichever way the park faces', Math.abs(w315[0] - Math.SQRT1_2) < 1e-9 && Math.abs(w315[2] - Math.SQRT1_2) < 1e-9 && Math.abs(w0[0] - 1) < 1e-9 && Math.abs(w0[2]) < 1e-9, `${w315.map((v) => v.toFixed(3))} / ${w0.map((v) => v.toFixed(3))}`);
  check('the sky: warmer toward the sun at dusk than away from it', at(18.5).hor[0] > at(18.5).horAway[0] && at(18.5).hor[2] / at(18.5).hor[0] < at(18.5).horAway[2] / at(18.5).horAway[0]);
  const g = skyLook(21, { glow: [255, 96, 168] }).glow;
  check('the sky: a venue\'s city glow, faint, at night', Math.abs(g[0] - DUSK.glow) < 1e-9 && g[0] > g[2] && g[2] > g[1], g.map((v) => v.toFixed(4)).join(','));
  // the windshield's rule: the first and last rows the same, or the hours past the last extrapolate
  const a = SKY[0], z = SKY[SKY.length - 1];
  check('the sky: the keyframes\' first and last rows are the same', same([a.top, a.hor, a.g1, a.g2, a.night, a.sun], [z.top, z.hor, z.g1, z.g2, z.night, z.sun]));
  // the weather over the park
  const { WX, BOLT, weatherOf, boltsBetween } = await import(P + 'diamond/weather.js');
  const { boltRibbon } = await import(P + 'gl/weather.js');
  const { growBolt } = await import('../../client/shared/lightning.js');
  const looks = Object.keys(WX).map((w) => [w, weatherOf({ word: w, rate: 0.6 })]);
  check('the weather: every word a look, each in range', looks.every(([, x]) => x.haze >= 1 && x.stars >= 0 && x.stars <= 1 && x.glow >= 1 && x.city > 0 && x.city <= 1 && x.wet >= 0 && x.wet <= 1 && (!x.fall || (x.fall.rate > 0 && x.fall.rate <= 1 && x.fall.speed > 0 && x.fall.n > 0))),
    looks.filter(([, x]) => !(x.haze >= 1)).map(([w]) => w).join(', '));
  check('the weather: none, or a word it doesn\'t know, is a clear night, and a clear night is the tuned night', weatherOf(null).word === 'clear' && weatherOf({ word: 'locusts' }).word === 'clear'
    && KEYS.every((k) => same(skyLook(21, { wx: { word: 'clear' } })[k], NIGHT[k])));
  const wetL = skyLook(21, { wx: { word: 'rain', rate: 0.8 } });
  check('the weather: rain wets the field, thickens the haze, hides the stars and dims the city', wetL.wet > 0.5 && wetL.fogDens > NIGHT.fogDens * 1.5 && wetL.stars === 0 && wetL.cityLit < NIGHT.cityLit
    && wetL.lights < 1 && weatherOf({ word: 'rain' }).fall.kind === 'rain');
  check('the weather: acid rain falls green, an ion storm strikes more often than a thunderstorm', weatherOf({ word: 'rain', event: 'acid_rain' }).fall.col[1] > weatherOf({ word: 'rain', event: 'acid_rain' }).fall.col[2]
    && weatherOf({ word: 'cloudy', event: 'ion_storm' }).bolts.n > weatherOf({ word: 'thunderstorm' }).bolts.n);
  const storm = weatherOf({ word: 'thunderstorm' }), tenMin = boltsBetween(storm, 0, 600);
  check('the weather: the bolts are the same twice, as many a minute as the weather says, out past the outfield', same(tenMin, boltsBetween(storm, 0, 600)) && Math.abs(tenMin.length - storm.bolts.n * 10) <= 1
    && tenMin.every((b) => b.dist >= BOLT.near && b.dist <= BOLT.far && Math.abs(b.bearing) <= 70) && new Set(tenMin.map((b) => Math.round(b.bearing / 10))).size >= 5 && !boltsBetween(weatherOf({ word: 'rain' }), 0, 600).length,
    `${tenMin.length} bolts`);
  const tree = growBolt(tenMin[0].seed, { gens: 3, segs: 12 }), rib = new Float32Array(200000), n = boltRibbon(tree, tenMin[0], [0, 74, -104], 1, 0.6, 0.0005, rib, 0);
  let ribBad = 0, low = Infinity, high = -Infinity, near = Infinity;
  for (let i = 0; i < n; i += 5) {
    for (let j = 0; j < 5; j++) if (!Number.isFinite(rib[i + j])) ribBad++;
    low = Math.min(low, rib[i + 1]); high = Math.max(high, rib[i + 1]); near = Math.min(near, Math.hypot(rib[i], rib[i + 2]));
  }
  check('the weather: a bolt\'s ribbon is finite, stands on the ground and reaches the cloud, out past the outfield', n > 30 && ribBad === 0 && low < 10 && high > tenMin[0].dist * 0.25 && near > 600, `${n / 5} vertices, ${low.toFixed(0)} to ${high.toFixed(0)} ft up, ${near.toFixed(0)} ft out`);
  // the birds (gl/parkbirds.js): the gulls up where gulls fly, clear of every tower's lamps and every
  // camera, over the park; the starlings up through the dusk and out toward the sunset
  const B = await import(P + 'gl/parkbirds.js');
  const circ = B.gullCircuits(), lamps = base.field.towers.map((T) => T.lamp), eyes = Object.values(C.SHOTS).map((s) => s.eye);
  let gBad = 0, gLo = Infinity, gHi = -Infinity, nearLamp = Infinity, nearEye = Infinity, gOut = 0;
  for (let i = 0; i < B.GULLS.n; i++) for (let t = 0; t < 600; t += 0.25) {
    const g = B.gullAt(circ, i, t);
    if (!g.every(Number.isFinite)) { gBad++; continue; }
    gLo = Math.min(gLo, g[1]); gHi = Math.max(gHi, g[1]);
    for (const l of lamps) nearLamp = Math.min(nearLamp, Math.hypot(g[0] - l[0], g[1] - l[1], g[2] - l[2]));
    for (const e of eyes) nearEye = Math.min(nearEye, Math.hypot(g[0] - e[0], g[1] - e[1], g[2] - e[2]));
    if (!G.insideOutline(base.outline, g, 0)) gOut++;
  }
  check('the birds: the gulls wheel over the park, up where gulls fly, clear of the towers\' lamps and the cameras', gBad === 0 && gLo >= 85 && gHi <= 180 && nearLamp >= 30 && nearEye >= 40 && gOut === 0,
    `${gLo.toFixed(0)} to ${gHi.toFixed(0)} ft up; ${nearLamp.toFixed(0)} ft from a lamp, ${nearEye.toFixed(0)} from a camera; ${gOut} over the wall`);
  const up = (h, evening = true) => B.starlingsUp(at(h).night, evening);
  check('the birds: the starlings are up at dusk, roosted by dark, and never up by day or at dawn', up(12) === 0 && up(17.5) > 0.9 && up(19.5) === 0 && up(22) === 0 && up(6, false) === 0,
    [12, 16.5, 17.5, 18.5, 19.5].map((h) => up(h).toFixed(2)).join(' '));
  const lean = (sun) => { const c = B.starlingsOver(sun); return [(Math.atan2(c[0], c[2]) * 180) / Math.PI, Math.hypot(c[0], c[2]), c[1]]; };
  const [a315, r315] = lean(at(18).sun), [a270] = lean(skyLook(18, { bearing: 270 }).sun), [a90] = lean(skyLook(18, { bearing: 90 }).sun);
  check('the birds: the starlings lean toward the sunset, no further off centre field than the sky camera looks', Math.abs(a315 - B.STARLINGS.lean) < 1e-9 && Math.abs(a270) < 1e-9 && Math.abs(Math.abs(a90) - B.STARLINGS.lean) < 1e-9
    && Math.abs(r315 - B.STARLINGS.reach) < 1e-6 && (() => { const q = C.project('sky', 1280, 720, B.starlingsOver(at(18).sun)); return !!q && q.x > 0 && q.x < 1280 && q.y > 0 && q.y < 720; })(), `${a315.toFixed(1)}°, ${a270.toFixed(1)}°, ${a90.toFixed(1)}°`);
  // the crowd's camera flashes (gl/crowd.js): never more than two in any second, a few a minute in a
  // quiet park and most windows in a loud one, and the same on every TV
  const { FLASH, flashesAt } = await import(P + 'gl/crowd.js');
  const born = (loud) => {
    const seen = new Map();
    for (let t = 0; t < 600; t += 0.01) for (const f of flashesAt(t, loud, 9000)) { const k = Math.round((t - f.age) * 1000); if (!seen.has(k)) seen.set(k, f.i); }
    return [...seen.keys()].sort((a, b) => a - b).map((k) => k / 1000);
  };
  const quiet = born(0), loud = born(1);
  let most = 0;
  for (const list of [quiet, loud]) for (let i = 0; i < list.length; i++) { let n = 1; while (i + n < list.length && list[i + n] - list[i] < 1) n++; most = Math.max(most, n); }
  check('the crowd: never more than two camera flashes in a second, a few a minute when it\'s quiet and most windows when it\'s loud', most <= 2 && quiet.length / 10 > 2 && quiet.length / 10 < 8 && loud.length / (600 / FLASH.window) > 0.8,
    `${most} at most; ${(quiet.length / 10).toFixed(1)} and ${(loud.length / 10).toFixed(1)} a minute`);
  check('the crowd: the same flashes twice, on a fan in the stands', JSON.stringify(flashesAt(123.4, 0.7, 9000)) === JSON.stringify(flashesAt(123.4, 0.7, 9000)) && flashesAt(5, 1, 0).length === 0
    && Array.from({ length: 2000 }, (_, k) => flashesAt(k * 0.3, 1, 9000)).flat().every((f) => Number.isInteger(f.i) && f.i >= 0 && f.i < 9000 && f.age >= 0 && f.age < FLASH.life));
}

// the picture's quality (diamond/quality.js): the tiers, the governor's rungs and the governor
{
  const Q = await import(P + 'diamond/quality.js');
  const cost = (k, v) => (k === 'ao' ? (v ? 1 / (v * v) : 0) : typeof v === 'boolean' ? (v ? 1 : 0) : +v || 0);
  const keys = Object.keys(Q.PARK_TIERS.full), [full, laptop, phone] = ['full', 'laptop', 'phone'].map((t) => Q.PARK_TIERS[t]);
  check('quality: every tier has every key, each no dearer than the tier above it', ['laptop', 'phone'].every((t) => keys.every((k) => k in Q.PARK_TIERS[t]))
    && keys.every((k) => cost(k, laptop[k]) <= cost(k, full[k]) && cost(k, phone[k]) <= cost(k, laptop[k])) && full.dpr === 2 && phone.dpr === 1 && phone.msaa === false && phone.shadows === 0,
    keys.filter((k) => !(cost(k, laptop[k]) <= cost(k, full[k]) && cost(k, phone[k]) <= cost(k, laptop[k]))).join(', '));
  const rungs = Q.rungsFor('full');
  const steps = rungs.slice(1).map((r, i) => keys.filter((k) => r[k] !== rungs[i][k]));
  check('quality: the full tier\'s rungs start at the tier and each takes something off and puts nothing back, the lens first and the resolution last',
    JSON.stringify(rungs[0]) === JSON.stringify(full) && steps.every((ks, i) => ks.length > 0 && ks.every((k) => cost(k, rungs[i + 1][k]) < cost(k, rungs[i][k])))
    && steps[0].join() === 'dof' && rungs[rungs.length - 1].dpr === 1 && rungs[rungs.length - 1].msaa === false && rungs.length === Q.PARK_STEPS.length + 1,
    steps.map((ks) => ks.join('+')).join(' / '));
  check('quality: a phone starts as low as the steps go, and the laptop tier on its own values', Q.rungsFor('phone').length === 1 && JSON.stringify(Q.rungsFor('laptop')[0]) === JSON.stringify(laptop) && JSON.stringify(Q.rungsFor('nonsense')[0]) === JSON.stringify(full));
  check('quality: a phone is a coarse pointer on a screen under 600 px on its short side, unless the player asked for the full tier', Q.parkTier({ coarse: true, shortSide: 390 }) === 'phone'
    && Q.parkTier({ coarse: true, shortSide: 800 }) === 'full' && Q.parkTier({ coarse: false, shortSide: 390 }) === 'full' && Q.parkTier({ coarse: true, shortSide: 390, stored: 'full' }) === 'full' && Q.parkTier() === 'full');
  // the governor, frame by frame: (interval s, seconds of them) → the rung at each change
  const run = (g, dt, secs) => { const out = []; for (let t = 0; t < secs; t += dt) { const q = g.frame(dt); if (q) out.push([+(t).toFixed(2), g.rung]); } return out; };
  {
    const g = Q.createGovernor(rungs);
    const steady = run(g, 1 / 60, 120);
    const gaps = run(g, 0.5, 120);
    const down = run(g, 0.04, 60);
    const spacing = down.slice(1).map((d, i) => d[0] - down[i][0]);
    check('quality: the governor holds at 60 a second and through a hidden tab, and steps down a rung each 1.2 s of slow frames to the last', steady.length === 0 && gaps.length === 0
      && down.length === rungs.length - 1 && g.rung === rungs.length - 1 && spacing.every((s) => s >= Q.GOVERNOR.down - 1e-9) && down[0][0] >= Q.GOVERNOR.down - 1e-9,
      `${down.length} steps, ${spacing.map((s) => s.toFixed(2)).join(' ')}`);
    const up1 = run(g, 1 / 60, 20);
    // the rung it came up to can't hold: down again, and the next try at it waits twice as long
    const back = run(g, 0.04, 3);
    const up2 = run(g, 1 / 60, 40);
    // (each a little after its wait, while the average comes down to the quick frames)
    const after = (x, wait) => x >= wait && x < wait + 0.6;
    check('quality: quick frames bring it back up a rung after 8 s, and the next return to a rung waits twice as long', up1.length >= 1 && after(up1[0][0], Q.GOVERNOR.up)
      && back.length >= 1 && up2.length >= 1 && after(up2[0][0], 2 * Q.GOVERNOR.up), JSON.stringify([up1, back, up2]));
    g.reset();
    check('quality: the governor resets to the tier', g.rung === 0 && JSON.stringify(g.quality) === JSON.stringify(full));
  }
  // the fans dealt for a tier's share: every one of them once, the same on every TV, and the first
  // three in ten spread through the stands as the whole crowd is
  {
    const S = M.CROWD_STRIDE, a = base.crowd.sit, d = Q.dealFans(a, S), d2 = Q.dealFans(a, S), n = a.length / S;
    const key = (arr, i) => `${arr[i * S]},${arr[i * S + 1]},${arr[i * S + 2]}`;
    const all = new Set(Array.from({ length: n }, (_, i) => key(a, i))), dealtSet = new Set(Array.from({ length: n }, (_, i) => key(d, i)));
    const m = Math.round(n * 0.3), meanY = (arr, k) => { let y = 0; for (let i = 0; i < k; i++) y += arr[i * S + 1]; return y / k; };
    const spanX = (arr, k) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < k; i++) { lo = Math.min(lo, arr[i * S]); hi = Math.max(hi, arr[i * S]); } return hi - lo; };
    check('quality: the fans dealt for a share are every fan once and the same twice, and the first three in ten fill the stands as the crowd does',
      d.length === a.length && dealtSet.size === all.size && [...all].every((k) => dealtSet.has(k)) && d.every((v, i) => v === d2[i])
      && Math.abs(meanY(d, m) - meanY(a, n)) < 0.05 * Math.abs(meanY(a, n)) + 1 && spanX(d, m) > 0.95 * spanX(a, n),
      `${meanY(d, m).toFixed(1)} against ${meanY(a, n).toFixed(1)} ft up; ${spanX(d, m).toFixed(0)} of ${spanX(a, n).toFixed(0)} ft across`);
  }
  // a burst at half its particles is the whole burst, thinner: the first half of the templates
  // reach all round
  {
    const { TEMPLATES, TEMPLATE_N } = await import(P + 'diamond/spectacle.js');
    const h = TEMPLATE_N / 2, mean = [0, 0, 0];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < h; i++) { for (let k = 0; k < 3; k++) mean[k] += TEMPLATES[i * 6 + k] / h; lo = Math.min(lo, TEMPLATES[i * 6 + 1]); hi = Math.max(hi, TEMPLATES[i * 6 + 1]); }
    check('quality: half a burst\'s particles still reach all round it', Math.hypot(...mean) < 0.15 && lo < -0.85 && hi > 0.85, `${Math.hypot(...mean).toFixed(3)} off centre, ${lo.toFixed(2)} to ${hi.toFixed(2)}`);
  }
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
  // the grounds crew in the middle of the fifth at a long hold: four, in the batting side's empty
  // slots, standing in foul ground beyond third, the base umpires out of their lanes; nobody else
  // moved for them
  const fifth = { ...p, phase: 'half', inning: 5, half: 'bottom', hold: CREW_HOLD * 1000 }, crewCast = castOf(fifth), crew = crewCast.filter((c) => c.look.role === 'crew');
  check('cast: the middle of the fifth at a long hold has the grounds crew, four of them', crewDue(fifth) && crew.length === 4 && !castOf({ ...fifth, hold: CREW_HOLD * 1000 - 1 }).some((c) => c.look.role === 'crew'), `${crew.length}`);
  check('cast: the crew in the batting side\'s empty slots', new Set(crewCast.map((c) => c.look.slot)).size === crewCast.length && crew.every((c) => c.look.side === 'home' && c.look.slot < 4));
  check('cast: the crew in foul ground beyond third', crew.every((c) => c.at[0] > c.at[2] + 10 && c.at[0] >= 90 && !onDirt(c.at[0], c.at[2])), crew.map((c) => c.at.map((x) => x.toFixed(1)).join(',')).join(' '));
  const umps = crewCast.filter((c) => c.look.role === 'ump' && c.id !== 'ump:plate' && c.id !== 'ump:2B');
  check('cast: the base umpires stand 10 ft clear of the crew\'s lanes', umps.length === 2 && umps.every((u) => crew.every((c) => Math.abs(u.at[2] - c.at[2]) >= 10)), umps.map((u) => u.at.join(',')).join(' '));
  // their work clothes: a body and a posed figure each, no club on them
  for (const c of crew.slice(0, 1)) {
    const look = PM.lookOf({ ...c.look, scale: c.scale }), G1 = PM.createPlayerSet(), G2 = PM.createPlayerSet({ skin: true });
    PM.buildPlayer(G1, Object.assign(PM.POSES.stand(), { at: c.at, yaw: c.yaw }), look);
    PM.buildBody(G2, look);
    let bad = 0, tris = 0;
    for (const G of [G1, G2]) for (const [, b] of G.batches) { tris += b.n / 3; for (let k = 0; k < b.n * (G === G2 ? PM.SKIN_STRIDE : M.STRIDE); k++) if (!Number.isFinite(b.data[k])) bad++; }
    check('cast: the crew\'s work clothes build, posed and skinned', bad === 0 && tris > 4000, `${tris} triangles, ${bad} bad`);
  }
  // a skinned body is who he is and what he wears: a new batter is one new body, and a runner who
  // moves up keeps his
  const keysOf = (q) => new Set(castOf(q).map(bodyKey));
  const before = keysOf(p), newBatter = [...keysOf({ ...p, batter: 'Okafor', bats: 'R' })].filter((k) => !before.has(k));
  check('cast: a new batter is one new body', newBatter.length === 1 && JSON.parse(newBatter[0])[0] === 'Okafor', newBatter.join(' '));
  const onFirst = castOf({ ...p, basesBefore: [true, false, false], moves: [{ from: 1, to: 2, name: 'Halvorsen' }] }).find((c) => c.id === 'Halvorsen');
  const onSecond = castOf({ ...p, basesBefore: [false, true, false], moves: [{ from: 2, to: 3, name: 'Halvorsen' }] }).find((c) => c.id === 'Halvorsen');
  check('cast: a runner keeps his body from bag to bag', onFirst && onSecond && bodyKey(onFirst) === bodyKey(onSecond) && onFirst.look.slot !== onSecond.look.slot);
  check('kits: a club wears its nickname', nicknameOf('Precinct 9 Enforcers') === 'Enforcers');
  // a club with an identity wears its own kit, home at home and road away, filled from the house
  // kit; a club without one, and every club before the set arrives, wears the house kit
  {
    const own = { base: '#efe9dc', ink: '#151113', trim: '#c8302c', cap: '#151113', wordmark: 'TESTERS' };
    const club = { colours: ['#c8302c'], crest: { box: 100, layers: [{ d: 'M10 10L90 10L90 90Z', fill: '#c8302c' }], small: [{ d: 'M20 20L80 20L80 80Z', fill: '#151113' }] },
      kit: { home: own, road: { ...own, base: '#8f9296', bill: '#c8302c', wordmark: 'TESTVILLE' } } };
    const teams = { home: 'Test Testers', away: 'Plain Placeholders' };
    check('kits: before the clubs arrive both sides wear the house kits', PM.sideKit('home', teams.home) === PM.KITS.home && PM.sideKit('away', teams.home) === PM.KITS.away);
    setClubs('baseball', 'smoke', { [teams.home]: club });
    const h = PM.sideKit('home', teams.home), r = PM.sideKit('away', teams.home), plain = PM.sideKit('away', teams.away);
    check('kits: a club wears its home kit at home and its road kit away', !h.house && h.wordmark === 'TESTERS' && r.wordmark === 'TESTVILLE' && r.base === '#8f9296' && h.sig !== r.sig);
    check('kits: what a club leaves out comes from the house kit', h.helmet === PM.KITS.home.helmet && h.bill === own.cap && r.bill === '#c8302c' && h.pants === own.base && h.number.length === 2);
    check('kits: a club with no identity wears the house kit', plain === PM.KITS.away);
    const wear = kitsFor(teams), cast = castOf(p).filter((c) => c.look.role !== 'ump' && c.look.role !== 'crew');
    check('kits: a cast is dressed in its clubs\' kits', wear.home === h && wear.away === plain);
    // the cap's colour follows the kit: the same man, house and club, builds differently
    const m = cast.find((c) => c.look.side === 'home' && !c.look.helmet && c.look.role !== 'catcher');
    if (m) {
      const colours = (kit) => { const G1 = PM.createPlayerSet(); PM.buildPlayer(G1, Object.assign(PM.POSES.stand(), { at: [0, 0, 0], yaw: 0 }), PM.lookOf({ ...m.look, ...(kit ? { kit } : {}) })); return [...G1.batches.get('plain').data.subarray(0, G1.batches.get('plain').n * M.STRIDE)].join(); };
      check('kits: a body built in a club\'s kit is coloured by it', colours(h) !== colours(null) && colours(PM.KITS.home) === colours(null));
    }
    let threw = null, atlas = null;
    try {
      atlas = paintKitAtlas(document, cast, { home: 'Plain Placeholders', away: 'Plain Placeholders' });
      const again = paintKitAtlas(document, cast, teams, atlas.canvas);
      check('kits: a club\'s kit arriving repaints its side\'s jerseys and legs, and only its side\'s', again.dirty.length === cast.filter((c) => c.look.side === 'home').length + 2, `${again.dirty.length} rects`);
      check('kits: the same kits again repaint nothing', paintKitAtlas(document, cast, teams, atlas.canvas).dirty.length === 0);
      paintLogos(document, teams);
    } catch (e) { threw = e.message; }
    check('kits: the atlas and the badges paint in a club\'s kit', !threw, threw);
    setClubs('baseball', '', {});
  }
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
  // a full count's worth and then some, to the corners of the plot and past them
  base.pitches = [{ x: 0, y: 0, result: 'ball' }, { x: 1, y: 1, result: 'swinging' }, { x: 0.3, y: 0.9, result: 'foul' }, { x: 0.9, y: 0.1, result: 'ball' },
    { x: 0.95, y: 0.5, result: 'hbp' }, { x: 0.6, y: 0.3, result: 'foul' }, { x: 0.1, y: 0.6, result: 'ball' }, base.pitch];
  const STATES = {
    'at-bat': { ...base, matchup: { batter: MAN, pitcher: MAN, bNum: 27, pNum: 31, bl: [612, 188, 44, 131, 41], pl: [14, 6, 612, 61, 201], batTeam: CLUB, pitchTeam: CLUB2 } },
    steal: { ...base, steal: { kind: 'caughtstealing', runner: MAN, num: 9, sb: 13, plate: 1.42, pop: 2.09, base: 3, team: CLUB } },
    splash: { ...base, splash: { kind: 'grandslam', word: 'GRAND SLAM', sub: `${MAN} · ${CLUB}` } },
    'the final': { ...base, gold: true, splash: { kind: 'walkoff', word: 'WALK-OFF!', sub: `${MAN} · ${CLUB}` } },
    // a home run's distance in the speed's box, under its card; the longest of a play's own words
    'a home run': { ...base, dist: { ft: 487, ev: 118 }, splash: { kind: 'homerun', word: 'HOME RUN', sub: `${MAN} · ${CLUB}` } },
    'over the rail': { ...base, splash: { kind: 'railcatch', sub: 'CENTER FIELD' } },
    // a replay's bug beside the score, with a home run's distance still up
    'a replay': { ...base, replay: true, dist: { ft: 487, ev: 118 } },
    'the leaders': { ...base, leaders: { race: 'hr', rows: batRows, season: 12, foot: `${CLUB} 12  ·  ${CLUB2} 10  ·  BOTTOM OF THE 11TH` } },
    'the strikeouts': { ...base, leaders: { race: 'k', rows: armRows, season: 12, foot: `TONIGHT  ·  ${CLUB} AT ${CLUB2}` } },
  };
  // a mark's box, the words measured the way a face sets capitals (FACE_ADVANCE)
  const wordW = (m, size) => String(m.s).length * H.FACE_ADVANCE[m.face] * size + Math.abs(m.skew ?? 0.2) * size * 0.75;
  const fitted = (m) => { const w = wordW(m, m.size); return !m.maxW || w <= m.maxW ? m.size : Math.max(m.min, m.size * m.maxW / w); };
  function boxOf(m) {
    switch (m.t) {
      case 'panel': case 'chip': case 'band': case 'box': case 'plot': return [m.x, m.y, m.x + m.w, m.y + m.h];
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
  const PERSIST = new Set(['score', 'count', 'speed', 'bug', 'pitches']);
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
    // the at-bat's flat zone: a dot per pitch, each inside the plot, numbered in order, and one down
    // the middle in the middle of the zone
    const plot = L.marks.find((m) => m.t === 'plot'), dots = L.marks.filter((m) => m.t === 'disc' && m.g === 'pitches');
    const nums = L.marks.filter((m) => m.t === 'text' && m.g === 'pitches').map((m) => m.s);
    check('pitches: a dot for each pitch of the at-bat, numbered in order', !!plot && dots.length === base.pitches.length && nums.join(',') === base.pitches.map((_, i) => i + 1).join(','), `${dots.length} dots, ${nums.join(',')}`);
    check('pitches: every dot is on the plot', !!plot && dots.every((d) => d.x >= plot.x - 0.5 && d.x <= plot.x + plot.w + 0.5 && d.y >= plot.y - 0.5 && d.y <= plot.y + plot.h + 0.5));
    const mid = dots[dots.length - 1], [zx, zy, zw, zh] = plot ? plot.zone : [0, 0, 0, 0];
    check('pitches: one down the middle is in the middle of the zone', !!mid && Math.abs(mid.x - (zx + zw / 2)) < 0.5 && Math.abs(mid.y - (zy + zh / 2)) < 0.5 && mid.edge === '#ffffff');
    check('pitches: no pitches, no plot', !H.layoutHud({ ...base, pitches: [] }, w, h, { project: proj }).marks.some((m) => m.g === 'pitches'));
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
  // the crowd's one figure in three poses (gl/crowd.js gets a fan up through them): each pose the
  // figure crowdMesh builds, vertex for vertex, and the towel only the cheer holds folded into the
  // hand in the other two
  {
    const { crowdMesh, crowdMorph, CROWD_MORPH, CROWD_VERTEX } = await import('../../client/game/js/panels/gl/ballpark-mesh.js');
    for (const far of [true, false]) {
      const M = crowdMorph({ far, towels: true }), n = M.length / CROWD_MORPH, poses = ['sit', 'stand', 'cheer'].map((k) => crowdMesh(k, { far, towels: k === 'cheer' }));
      let bad = 0, folded = 0;
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
        const src = poses[k], at = i * CROWD_VERTEX;
        if (at < src.length) { for (let j = 0; j < 6; j++) if (M[i * CROWD_MORPH + k * 6 + j] !== src[at + j]) bad++; }
        else folded++;
      }
      check(`crowd (${far ? 'far' : 'near'}): one figure in three poses, vertex for vertex`, !bad && n === poses[2].length / CROWD_VERTEX && folded === 2 * (n - poses[0].length / CROWD_VERTEX), `${bad} off, ${folded} folded`);
    }
  }
  // every kind of card the grandstand puts up has its words
  const W = H.HUD_THEME.words;
  check('theme: a word for every splash and steal', ['homerun', 'grandslam', 'walkoff', 'doubleplay', 'tripleplay', 'extras', 'gamewin', 'champion', 'matchup', 'steal', 'caughtstealing', 'doublesteal', 'strikeout', 'walk',
    'hitbypitch', 'triple', 'error', 'robbed', 'wallcatch', 'divingcatch', 'slidingcatch', 'railcatch', 'divingstop', 'barehand', 'pickoff', 'wildpitch', 'passedball', 'replay'].every((k) => W[k]));
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
    check('graphics: the states between them use every kind of mark', ['panel', 'text', 'bulb', 'chip', 'bag', 'zone', 'mark', 'burst', 'disc', 'rays', 'veil', 'band', 'rule', 'box', 'plot'].every((k) => kinds.has(k)), [...kinds].join(','));
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
