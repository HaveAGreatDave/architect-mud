// Arena smoke: the GLASS 2 rink (client/game/js/panels/gl/arena.js) checked without a GPU.
//
// The arena renderer itself needs WebGL2, which node hasn't got, so this checks the three
// things it stands on that can be checked here:
//
//   1. THE MATRICES AGREE WITH THE 2-D CAMERA. `matrices()` in rink/camera.js writes the
//      broadcast camera out as GL matrices by hand. If it drifts from `P`, the GL picture
//      and the 2-D fallback frame a shot differently, and the mirror pass reflects the
//      wrong place. Every camera mode, both views, two screen shapes, a few hundred
//      points each, to a hundredth of a pixel; and the mirror matrix against P(x, y, −z).
//   2. THE MESHES ARE SOUND. Every body the world can show (skaters, goalies, officials,
//      medics; ragdolled, missing an arm, a leg or the head, gloves off, helmet off,
//      jersey over the head, a visor), the severed limbs, debris, the Zamboni, the nets,
//      the puck, the stretcher: built by arena-mesh.js, every float finite, nothing
//      empty, and the frame inside its triangle budget.
//   3. THE ICE LISTS WHAT CHANGED. GLASS 2 uploads only the tiles a paint touched, so a
//      mark that forgets to list its tile leaves the GL sheet stale while the 2-D one is
//      right. Each kind of mark is checked against the tile it lands in.
//
// And with no WebGL2 to be had, `createArenaRenderer` returns null rather than throwing,
// which is how the view knows to draw in 2-D.
//
// Run:  node scripts/shapes/arena-smoke.mjs

import { __install } from './rink-dom-stub.mjs';

__install();
const R = '../../client/game/js/panels/';
const { createRinkCamera, matrices, project, NEAR } = await import(R + 'rink/camera.js');
const { createIce, TPX, ICE_TILE } = await import(R + 'rink/textures.js');
const { createWorld } = await import(R + 'rink/sim.js');
const { createDirector } = await import(R + 'rink/director.js');
const { bodyOpts } = await import(R + 'rink/hud.js');
const { DT } = await import(R + 'rink/rig.js');
const { RW, GOAL_X, MID_Y, NET_HALF, NET_DEPTH, NET_H } = await import(R + 'rink/geo.js');
const M = await import(R + 'gl/arena-mesh.js');
const { createArenaRenderer } = await import(R + 'gl/arena.js');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};

// ── 1. the matrices ──────────────────────────────────────────────────────────
{
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (const mode of ['broadcast', 'fight', 'zoom', 'push', 'zam', 'death']) for (const view of ['broadcast', 'low']) for (const [w, h] of [[1350, 760], [390, 640]]) {
    const W = { t: 3, cam: { mode, focus: [60 + rnd() * 80, 20 + rnd() * 45], cut: 1, since: 1 } };
    const cam = createRinkCamera(W);
    cam.view = view;
    const { C, P } = cam.update(w, h);
    const M0 = matrices(C), MR = matrices(C, true);
    let worst = 0, worstR = 0, sideBad = 0, depthBad = 0;
    for (let i = 0; i < 300; i++) {
      const x = -30 + rnd() * 260, y = -30 + rnd() * 150, z = rnd() * 40;
      const p = P(x, y, z), q = project(M0.viewProj, x, y, z, w, h);
      if (p) {
        if (!q) { sideBad++; continue; }
        worst = Math.max(worst, Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.d - q.d));
        // clip-space depth lands inside the depth range for anything P keeps
        const m = M0.viewProj, cz = m[2] * x + m[6] * y + m[10] * z + m[14], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (p.d < 590 && (cz / cw < -1.0001 || cz / cw > 1.0001)) depthBad++;
      } else if (q && q.d >= NEAR + 1e-9) sideBad++;
      const pr = P(x, y, -z), qr = project(MR.viewProj, x, y, z, w, h);
      if (pr && qr) worstR = Math.max(worstR, Math.abs(pr.x - qr.x), Math.abs(pr.y - qr.y));
      else if (pr ? !qr : qr && qr.d >= NEAR + 1e-9) sideBad++;
    }
    const tag = `${mode}/${view} ${w}x${h}`;
    check(`camera ${tag}: GL matrix matches P`, worst < 0.01, `worst ${worst.toFixed(4)} px`);
    check(`camera ${tag}: mirror matrix matches P(x, y, -z)`, worstR < 0.01, `worst ${worstR.toFixed(4)} px`);
    check(`camera ${tag}: near-plane agreement`, sideBad === 0, `${sideBad} points`);
    check(`camera ${tag}: depth inside the range`, depthBad === 0, `${depthBad} points`);
  }
}

// ── 2. the meshes ────────────────────────────────────────────────────────────
const ice = createIce(document);
const W = createWorld(ice, 'arena-smoke');
createDirector(W, {});
for (let i = 0; i < 240; i++) W.step(DT);

const finite = (b) => { for (let i = 0, n = b.n * M.STRIDE; i < n; i++) if (!Number.isFinite(b.data[i])) return false; return true; };
const SLOT = [0, 0, 0.125, 0.125];
function body(b, label, mut, budget) {
  const d = M.createBatch(), t = M.createBatch(), tr = M.createBatch();
  for (const det of [0, 1]) {
    M.reset(d); M.reset(t); M.reset(tr);
    const o = { ...bodyOpts(W, b), detail: det, slot: SLOT, ...(mut || {}) };
    M.buildBody(d, t, W.rigOf(b), o);
    M.buildVisor(tr, o);
    const tris = (d.n + t.n) / 3;
    check(`${label} det${det}: finite`, finite(d) && finite(t) && finite(tr));
    check(`${label} det${det}: has a body`, d.n > 300 && t.n > 0, `${d.n} + ${t.n} verts`);
    check(`${label} det${det}: inside budget`, tris <= budget[det], `${tris | 0} tris > ${budget[det]}`);
    if (mut && mut.face === 'visor' && mut.helmet !== false) check(`${label} det${det}: visor built`, tr.n > 0);
  }
}
const skaters = W.bodies().filter((b) => b.kind === 'skater');
const BUD = [1500, 2600], BUD_GK = [1700, 2800];
body(skaters[0], 'skater', null, BUD);
body(W.goalie.a, 'goalie', null, BUD_GK);
body(W.officials[0], 'official', null, BUD);
body(skaters[1], 'skater gloves off, helmet off', { gloves: false, helmet: false }, BUD);
body(skaters[2], 'skater jersey over the head', { jerseyUp: 1 }, BUD);
body(skaters[3], 'skater visor', { face: 'visor' }, BUD);
body(skaters[4], 'skater bloodied', { blood: 1, react: 1 }, BUD);
{
  const medic = W.extras.find((b) => b.kind === 'medic');
  if (medic) body(medic, 'medic', null, BUD);
  check('a medic exists to build', !!medic);
}
// casualties: a ragdoll, and men missing parts (the severed parts become limbs)
W.knock(skaters[5], [14, 2, 6], [6, 0, 2]);
W.sever(skaters[6], 'armL', [6, 2, 4]);
W.sever(skaters[7], 'legR', [4, -3, 3]);
W.sever(skaters[8], 'head', [2, 5, 9]);
for (let i = 0; i < 90; i++) W.step(DT);
check('the knocked man is a ragdoll', !!skaters[5].rag);
body(skaters[5], 'skater ragdoll', null, BUD);
body(skaters[6], 'skater missing an arm', null, BUD);
body(skaters[7], 'skater missing a leg', null, BUD);
body(skaters[8], 'skater missing his head', null, BUD);
{
  const b = M.createBatch();
  for (const l of W.limbs) { const n0 = b.n; M.buildSevered(b, l, bodyOpts(W, l.owner || { side: l.side })); check(`severed ${l.part}: built`, b.n > n0); }
  check('three limbs came off', W.limbs.length === 3, `${W.limbs.length}`);
  check('severed limbs: finite', finite(b));
}
// the loose things and the furniture
{
  const b = M.createBatch(), t = M.createBatch();
  for (const kind of ['stick', 'glove', 'helmet']) W.addDebris(kind, [90, 40, 1], [3, 1, 2], 0.7, 2, 'a');
  for (let i = 0; i < 30; i++) W.step(DT);
  for (const d of W.debris) { const n0 = b.n; M.buildDebris(b, d, W.kits[d.side] || W.kits.a); check(`debris ${d.kind}: built`, b.n > n0); }
  let n0 = b.n; M.buildPuck(b, W.puck); check('puck: built', b.n > n0);
  n0 = b.n; M.buildStretcher(b, { x: 20, y: 2, h: 0.3 }); check('stretcher: built', b.n > n0);
  n0 = b.n; const t0 = t.n;
  M.buildNet(b, t, GOAL_X[0], -1, MID_Y, NET_HALF, NET_DEPTH, NET_H, 0.4);
  check('net: frame and mesh built', b.n > n0 && t.n > t0);
  W.startZamboni(46);
  for (let i = 0; i < 240; i++) W.step(DT);
  check('the Zamboni is out', !!W.zamboni);
  if (W.zamboni) { n0 = b.n; const t1 = t.n; M.buildZamboni(b, t, W.zamboni, W.t); check('Zamboni: body and lettering built', b.n > n0 && t.n > t1); }
  check('furniture: finite', finite(b) && finite(t));
}
// a whole frame, every man near the camera
{
  const d = M.createBatch(), t = M.createBatch();
  for (const b of W.bodies()) M.buildBody(d, t, W.rigOf(b), { ...bodyOpts(W, b), detail: 1, slot: SLOT });
  const tris = (d.n + t.n) / 3;
  check('a full frame of bodies: finite', finite(d) && finite(t));
  check('a full frame of bodies: inside 60k triangles', tris < 60000, `${tris | 0}`);
}
// quads take an atlas slot's UVs, so a jersey can't bleed into its neighbour's
{
  const t = M.createBatch(), d = M.createBatch();
  M.buildBody(d, t, W.rigOf(skaters[0]), { ...bodyOpts(W, skaters[0]), detail: 1, slot: [0.25, 0.5, 0.375, 0.625] });
  let ok = true;
  for (let i = 0; i < t.n; i++) { const o = i * M.STRIDE, u = t.data[o + 10], v = t.data[o + 11]; if (u < 0.25 - 1e-6 || u > 0.375 + 1e-6 || v < 0.5 - 1e-6 || v > 0.625 + 1e-6) { ok = false; break; } }
  check('jersey UVs stay inside their slot', ok);
}

// ── 3. the ice lists what changed ────────────────────────────────────────────
{
  const { TX } = ice.tiles;
  const tileOf = (x, y) => Math.floor((RW - y) * TPX / ICE_TILE) * TX + Math.floor(x * TPX / ICE_TILE);
  const fresh = () => { ice.dirtyAll = false; ice.dirty.fill(0); };
  ice.reset(3);
  check('a reset re-uploads the whole sheet', ice.dirtyAll === true);
  const marks = [
    ['blood', () => ice.blood(100, 42, 0.4, 0.8, 7), 100, 42],
    ['cut', () => ice.cut(60, 20, 60.4, 20.1, 0.5), 60, 20],
    ['scrape', () => ice.scrape(140, 60, 1, 0, 2.5, 9), 140, 60],
    ['puck mark', () => ice.puckMark(30, 2, 0, -1), 30, 2],
    ['smear', () => ice.smear(80, 30, 81, 30.5, 0.4, 0.3), 80, 30],
    ['resurface', () => ice.resurface(120, 50, 3.7, 0), 120, 50],
  ];
  for (const [name, fn, x, y] of marks) {
    fresh(); fn(); ice.flush();
    check(`a ${name} lists its tile`, ice.dirty[tileOf(x, y)] === 1);
    check(`a ${name} lists only nearby tiles`, ice.dirty.reduce((a, v) => a + v, 0) <= 6, `${ice.dirty.reduce((a, v) => a + v, 0)} tiles`);
  }
  fresh(); ice.resurface(120, 50, 3.7, 0);
  check('a resurface marks the wet mask for upload', ice.wetDirty === true);
}

// ── 4. no WebGL2, no arena ───────────────────────────────────────────────────
{
  const cv = document.createElement('canvas');
  let r, threw = null;
  try { r = createArenaRenderer(cv, null, W, ice); } catch (e) { threw = e; }
  check('createArenaRenderer without WebGL2: no throw', !threw, threw && threw.message);
  check('createArenaRenderer without WebGL2: null, so the view draws in 2-D', r === null);
}

console.log(`arena smoke: ${passes}/${passes + failures} passed`);
process.exit(failures ? 1 : 0);
