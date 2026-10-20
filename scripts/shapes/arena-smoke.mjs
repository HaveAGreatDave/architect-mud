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
//      empty, and the frame inside its triangle budget. Each body's head record (the
//      street figures' generator's head, drawn by gl/arena-heads.js) is sound, the helmet
//      clears the skull and every haircut, and so does a keeper's mask.
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
  for (const mode of ['broadcast', 'fight', 'zoom', 'push', 'zam', 'death']) for (const view of ['broadcast', 'low', 'vertical']) for (const [w, h] of [[1350, 760], [390, 640]]) {
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
// close up (det1) a man has gauntlets, a ridged helmet, ear guards and elbow pads, so his
// budget is higher than a man at broadcast distance (det0)
const BUD = [1500, 3200], BUD_GK = [1700, 3400];
body(skaters[0], 'skater', null, BUD);
body(W.goalie.a, 'goalie', null, BUD_GK);
body(W.officials[0], 'official', null, BUD);
body(skaters[1], 'skater gloves off, helmet off', { gloves: false, helmet: false }, BUD);
body(skaters[2], 'skater jersey over the head', { jerseyUp: 1 }, BUD);
body(skaters[3], 'skater visor', { face: 'visor' }, BUD);
body(skaters[4], 'skater bloodied', { blood: 1, react: 1 }, BUD);
{
  const medic = W.extras.find((b) => b.kind === 'medic' && !b.crew), crew = W.extras.find((b) => b.crew);
  if (crew) body(crew, 'ice crew', null, BUD);
  check('the ice crew exist to build', !!crew);
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
  W.startZamboni(10);   // (half a second of a ten-times time-lapse: in at the gate, short of the limbs)
  for (let i = 0; i < 60; i++) W.step(DT);
  check('the Zamboni is out', !!W.zamboni);
  if (W.zamboni) { n0 = b.n; const t1 = t.n; M.buildZamboni(b, t, W.zamboni, W.t); check('Zamboni: body and lettering built', b.n > n0 && t.n > t1); }
  // (and off again: left out, it drives the pattern and sweeps up the limbs the checks below build)
  W.zamboni = null;
  check('furniture: finite', finite(b) && finite(t));
  // the tail a shot leaves: a ribbon through its last points, faced to the camera
  const tl = M.createBatch();
  M.ribbon(tl, [[100, 40, 0.1], [101.5, 40.2, 0.15], [103, 40.4, 0.3], [104.5, 40.6, 0.5]], [100, -30, 30], 0.04, 0.5, [1, 1, 1, 0], [1, 1, 1, 0.5]);
  check('shot tail: a ribbon of three segments', tl.n === 18 && finite(tl), `${tl.n} verts`);
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

// ── the heads ────────────────────────────────────────────────────────────────
// Handed `heads`, a body leaves its head as a record for gl/arena-heads.js to draw from the
// street figures' generator: one a body that has a head to show, its matrix a rigid map at
// HEAD_S, and a face from a layout without makeup. The helmet is built round it, so the
// skull and every haircut it can wear under one must clear the shell, and the face the cage.
{
  const { headMesh, hairMesh, HEAD_FEAT } = await import(R + 'actor-head.js');
  const { FACE_LAYOUTS } = await import(R + 'actor-faces.js');
  const { rinkFace } = await import(R + 'rink/faces.js');
  const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;
  const rigid = (m) => {
    const c = [0, 4, 8].map((k) => [m[k], m[k + 1], m[k + 2]]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const det = dot(c[0], [c[1][1] * c[2][2] - c[1][2] * c[2][1], c[1][2] * c[2][0] - c[1][0] * c[2][2], c[1][0] * c[2][1] - c[1][1] * c[2][0]]);
    return m.every(Number.isFinite) && c.every((v) => near(Math.hypot(...v), M.HEAD_S)) && near(dot(c[0], c[1]), 0) && near(dot(c[1], c[2]), 0) && near(dot(c[0], c[2]), 0) && det > 0;
  };
  const d = M.createBatch(), t = M.createBatch();
  const heads = (b, mut, det = 1) => {
    const out = [];
    M.reset(d); M.reset(t);
    M.buildBody(d, t, W.rigOf(b), { ...bodyOpts(W, b), detail: det, slot: SLOT, heads: out, headLv: det ? 0 : 2, ...(mut || {}) });
    return out;
  };
  for (const [label, b, mut] of [['skater', skaters[0]], ['goalie', W.goalie.a], ['official', W.officials[0]], ['helmet off', skaters[1], { helmet: false }], ['visor', skaters[3], { face: 'visor' }], ['bloodied', skaters[4], { blood: 1, react: 1 }], ['ragdoll', skaters[5]]]) {
    for (const det of [0, 1]) {
      const hs = heads(b, mut, det), h = hs[0];
      check(`head ${label} det${det}: one record`, hs.length === 1, `${hs.length}`);
      if (!h) continue;
      check(`head ${label} det${det}: a rigid map at HEAD_S`, rigid(h.M));
      check(`head ${label} det${det}: its level`, h.lv === (det ? 0 : 2));
      check(`head ${label} det${det}: a face without makeup`, !FACE_LAYOUTS[h.face.layout].makeup);
      check(`head ${label} det${det}: a hair mesh that exists`, Number.isInteger(h.hs) && h.hs >= 0 && h.hs < 5);
      check(`head ${label} det${det}: blood only when he's bleeding`, (h.blood > 0) === (label === 'bloodied'), `${h.blood}`);
    }
  }
  check('no head record for a jersey over the head', heads(skaters[2], { jerseyUp: 1 }).length === 0);
  check('no head record for a man missing his head', heads(skaters[8]).length === 0);
  {
    const o = { ...bodyOpts(W, skaters[0]) }, quiff = (helmet) => M.headRecord([0, 0, 6], [1, 0, 0], [0, 1, 0], [0, 0, 1], { ...o, name: 'Test5' }, 0, 0, helmet);
    check('a quiff is drawn bare-headed', quiff(false).face.style === 4 && quiff(false).hs === 4);
    check('a quiff is cropped under a helmet', quiff(true).hs === 0);
    const long = (goalie) => M.headRecord([0, 0, 6], [1, 0, 0], [0, 1, 0], [0, 0, 1], { ...o, name: 'Test0', goalie }, 0, 0, true);
    check("long hair hangs out of a skater's helmet and is tucked under a keeper's mask", long(false).face.style === 3 && long(false).hs === 3 && long(true).hs === 2);
  }
  {
    const lim = W.limbs.find((l) => l.part === 'head'), b = M.createBatch(), out = [];
    M.buildSevered(b, lim, { ...bodyOpts(W, lim.owner), heads: out });
    check('a severed head leaves one record and a shell', out.length === 1 && rigid(out[0].M) && b.n > 0 && finite(b));
  }
  // The same name is the same face whatever body he's in; no player or official is given makeup.
  {
    const a = rinkFace({ name: 'Lindqvist', seed: 3, skin: '#e0b08c', hair: '#2a1c14' }), z = rinkFace({ name: 'Lindqvist', seed: 41, skin: '#e0b08c', hair: '#2a1c14' });
    check('a face follows the name, not the body', a.layout === z.layout && a.style === z.style);
    let made = 0;
    for (const kind of ['skater', 'goalie', 'official']) for (let i = 0; i < 300; i++) if (FACE_LAYOUTS[rinkFace({ name: `${kind}${i}`, kind }).layout].makeup) made++;
    check('no player or official wears a makeup layout', made === 0, `${made}`);
  }
  // The fit, in the head's own frame: every skull and hair vertex under the shell is inside its
  // liner (0.95), so no facet of the shell cuts through, and the face is behind the cage.
  const rec = M.headRecord([M.HEAD_AT[0], 0, M.HEAD_AT[1]], [1, 0, 0], [0, 1, 0], [0, 0, 1], { name: 'Fit' }, 0, 0, true), m = rec.M;
  const at = (P, i) => [0, 1, 2].map((k) => m[k] * P[i * 3] + m[4 + k] * P[i * 3 + 1] + m[8 + k] * P[i * 3 + 2] + m[12 + k]);
  for (const [who, R0, brow] of [['skater', 0.46, M.HELM_BROW]]) {
    let worst = 0, worstStyle = -1, cageWorst = -1;
    const scan = (src, style) => {
      for (let i = 0; i < src.P.length / 3; i++) {
        if (src.F[i] === HEAD_FEAT.neck) continue;
        const w = at(src.P, i);
        const x = (w[0] - M.HELM_C[0]) / R0, y = w[1] / R0, z = (w[2] - M.HELM_C[1]) / (R0 * 0.92), r = Math.hypot(x, y, z);
        const shell = !(z / r < -0.6 || (x / r > M.HELM_OPEN && z / r < brow));
        if (shell && r > worst) { worst = r; worstStyle = style; }
        const a = Math.atan2(w[1], w[0]);
        if (style < 0 && Math.abs(a) < 1.05 && w[2] < M.BRIM_U && w[2] > -0.64) cageWorst = Math.max(cageWorst, Math.hypot(w[0], w[1]) - (M.faceRad(R0, w[2]) - 0.018));
      }
    };
    scan(headMesh(0), -1);
    for (let s = 0; s < 5; s++) scan(hairMesh(s === 4 ? 0 : s, 0), s);
    check(`${who} helmet: the skull and every haircut clear the shell`, worst < 0.95, `r ${worst.toFixed(3)}, style ${worstStyle}`);
    check(`${who} helmet: the face is behind the cage`, cageWorst < 0, `${cageWorst.toFixed(3)} ft through`);
  }
  // A keeper's mask, at both levels. A ray from the mask's middle through every skull and hair
  // vertex either leaves by the opening or meets the shell well outside the vertex; nothing on
  // the face comes within a bar's thickness of the cage, and the nose is behind it.
  for (const lv of [0, 1]) {
    const T = M.maskTemplate(lv), O = M.MASK_O, tris = [];
    const P = (k) => [T.pos[k * 3], T.pos[k * 3 + 1], T.pos[k * 3 + 2]];
    for (let j = 0; j < T.rows; j++) for (let i = 0; i < T.S - 1; i++) {
      if (T.open(i, j)) continue;
      const k00 = j * T.S + i, k10 = k00 + 1, k01 = k00 + T.S, k11 = k01 + 1;
      tris.push([P(k00), P(k01), P(k11)], [P(k00), P(k11), P(k10)]);
    }
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    // the nearest shell crossing along the ray from O toward d (Möller–Trumbore), or Infinity
    const hit = (d) => {
      let best = Infinity;
      for (const [a, b, c] of tris) {
        const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
        if (Math.abs(det) < 1e-12) continue;
        const tv = sub(O, a), u = dot(tv, p) / det; if (u < -1e-6 || u > 1 + 1e-6) continue;
        const q = cross(tv, e1), v = dot(d, q) / det; if (v < -1e-6 || u + v > 1 + 1e-6) continue;
        const t = dot(e2, q) / det; if (t > 0 && t < best) best = t;
      }
      return best;
    };
    let tight = Infinity, tightAt = '', through = 0, open = [];
    const scan = (src, label) => {
      for (let i = 0; i < src.P.length / 3; i++) {
        if (src.F[i] === HEAD_FEAT.neck) continue;
        const w = at(src.P, i), v = sub(w, O), r = Math.hypot(...v);
        if (src === headMesh(0) && w[2] < -0.3 && w[0] < 0.1) continue;   // (the jaw under the backplate's edge, behind the cup)
        const t = hit(v.map((x) => x / r));
        if (t === Infinity) { if (label === 'skull') open.push(w); continue; }
        if (t - r < tight) { tight = t - r; tightAt = label; }
        if (t - r < (lv ? 0.02 : 0.01)) through++;   // (L0's coarser facets cut closer, at under 24 px a foot)
      }
    };
    scan(headMesh(0), 'skull');
    // (a keeper's quiff is cropped and his long hair tucked in, so these are all he can wear)
    for (let st = 0; st < 3; st++) scan(hairMesh(st, 0), `hair ${st}`);
    check(`mask L${lv}: the skull and every haircut sit inside the shell`, through === 0, `${through} vertices too close, the closest ${tight.toFixed(3)} ft (${tightAt})`);
    const segs = T.bars.flatMap((bar) => bar.slice(1).map((q, k) => [bar[k], q]));
    const near = (p) => Math.min(...segs.map(([a, b]) => { const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab))); return Math.hypot(...sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])); }));
    const gap = Math.min(...open.map(near));
    check(`mask L${lv}: the face is clear of the cage`, open.length > 50 && gap > 0.03, `${open.length} face vertices, ${gap.toFixed(3)} ft from a bar`);
    // the bar up the middle stands in front of everything on the face on the centre line
    const mid = T.bars[0];
    const ahead = open.filter((w) => Math.abs(w[1]) < 0.05).every((w) => {
      const k = mid.findIndex((q, n) => n + 1 < mid.length && (q[2] - w[2]) * (mid[n + 1][2] - w[2]) <= 0);
      if (k < 0) return true;
      const a = mid[k], b = mid[k + 1], f = a[0] + (b[0] - a[0]) * ((w[2] - a[2]) / ((b[2] - a[2]) || 1));
      return f > w[0] + 0.03;
    });
    check(`mask L${lv}: the nose is behind the cage`, ahead);
    // painted from its own cell of the masks' texture, and only from it, into the masks' batch
    const b = M.createBatch(), bt = M.createBatch(), bm = M.createBatch(), slot = [0.25, 0.5, 0.375, 0.625];
    M.buildMask(b, bt, [100, 40, 5], [1, 0, 0], [0, 1, 0], [0, 0, 1], { kit: W.kits.a, maskSlot: slot, maskBatch: bm }, lv);
    let inSlot = bm.n > 0;
    for (let i = 0; i < bm.n; i++) { const o = i * M.STRIDE, u = bm.data[o + 10], v = bm.data[o + 11]; if (u < slot[0] - 1e-6 || u > slot[2] + 1e-6 || v < slot[1] - 1e-6 || v > slot[3] + 1e-6 || bm.data[o + 12] !== 1) { inSlot = false; break; } }
    check(`mask L${lv}: the shell's paint stays in its cell`, inSlot && bt.n === 0 && finite(b) && finite(bm) && b.n > 0, `${bm.n} shell, ${bt.n} in the jerseys' batch`);
  }
  // a keeper wears it on the ice, and his head keeps it when it comes off
  {
    const gk = W.goalie.a, d = M.createBatch(), t = M.createBatch(), m = M.createBatch(), hs = [];
    M.buildBody(d, t, W.rigOf(gk), { ...bodyOpts(W, gk), detail: 1, slot: SLOT, maskSlot: [0.5, 0.5, 0.625, 0.625], maskBatch: m, heads: hs, headLv: 0 });
    check('a keeper with a head record wears the mask', hs.length === 1 && m.n > 0 && finite(m) && (d.n + t.n + m.n) / 3 <= BUD_GK[1], `${((d.n + t.n + m.n) / 3) | 0} tris`);
    W.sever(gk, 'head', [3, 2, 6]);
    for (let i = 0; i < 30; i++) W.step(DT);
    const lim = W.limbs.find((l) => l.owner === gk), b2 = M.createBatch(), t2 = M.createBatch(), m2 = M.createBatch(), out = [];
    M.buildSevered(b2, lim, { ...bodyOpts(W, gk), heads: out, maskSlot: [0.5, 0.5, 0.625, 0.625], maskBatch: m2 }, t2);
    check("a keeper's severed head keeps his mask", out.length === 1 && m2.n > 0 && finite(b2) && finite(m2));
  }
}

// ── the puck is never put on a stick ─────────────────────────────────────────
// It's collected: he skates to it and takes it once it's within reach of his blade, out of
// the net through the mouth, and it never moves farther in a step than a hard shot carries
// it. (No beat is running: the pregame's linesman would otherwise come and pick it up for
// the opening draw while he's on his way.)
{
  const W2 = createWorld(createIce(document), 'collect');
  const D2 = createDirector(W2, {});
  for (let i = 0; i < 60; i++) W2.step(DT);
  D2.reset();
  const pk = W2.puck, m = W2.skaters().find((b) => b.active && b.stick);
  const watch = (secs) => { let worst = 0; for (let i = 0; i < secs / DT && pk.carrier !== m; i++) { const x = pk.x, y = pk.y; W2.step(DT); worst = Math.max(worst, Math.hypot(pk.x - x, pk.y - y)); } return worst; };
  W2.puckScripted = true; W2.frozen = true;
  // from 40 feet: a give becomes a collect, and it arrives
  if (pk.carrier) W2.loose(0, 0);
  pk.x = m.x + 40; pk.y = Math.min(RW - 5, Math.max(5, m.y)); pk.z = 0; pk.vx = pk.vy = 0;
  check('a give from 40 ft is refused', W2.give(m) === false && pk.carrier !== m);
  let worst = watch(4);
  check('a collected puck arrives on his stick', pk.carrier === m);
  check('a collected puck never jumps', worst < 1.6, `${worst.toFixed(2)} ft in a step`);
  // out of the net: through the mouth, not the mesh
  W2.loose(0, 0); pk.x = GOAL_X[1] + 1.6; pk.y = MID_Y; pk.z = 0; pk.inNet = 'h';
  m.x = GOAL_X[1] - 14; m.y = MID_Y; m.vx = m.vy = 0;
  W2.give(m);
  worst = watch(5);
  check('a netted puck comes out through the mouth to him', pk.carrier === m && !pk.inNet, `carrier ${pk.carrier && pk.carrier.name}, inNet ${pk.inNet}`);
  check('coming out of the net it never jumps', worst < 1.6, `${worst.toFixed(2)} ft in a step`);
}

// ── positions ────────────────────────────────────────────────────────────────
// Between plays the men play their positions. Set a club up with the puck deep in the
// other end and they should be on the points, at the net and in support, with the other
// side's defence in front of their goal; carry it through the neutral zone and the wingers
// are wide in their lanes and onside.
{
  const W3 = createWorld(createIce(document), 'positions');
  createDirector(W3, {});
  W3.script = null; W3.puckScripted = false; W3.frozen = false;
  const atk = 'a', dir = 1, offBlue = W3.offBlue(atk), offGoal = W3.offGoal(atk);
  const fwd = W3.mates(atk).find((m) => m.slot === 0);
  const hold = () => { const pk = W3.puck; if (pk.carrier !== fwd) { pk.x = fwd.x + 2; pk.y = fwd.y; pk.z = 0; pk.vx = pk.vy = 0; W3.give(fwd, true); } W3.amb.nextPass = W3.t + 99; W3.amb.lastTurn = W3.t; };
  // in the zone
  fwd.x = offGoal - 20; fwd.y = 12; hold();
  for (let i = 0; i < 5 / DT; i++) { hold(); W3.step(DT); }
  const ds = W3.mates(atk).filter((m) => m.slot === 3 || m.slot === 4);
  check('in the zone: both D are on the points', ds.length === 2 && ds.every((d) => Math.abs(d.x - offBlue) < 9), ds.map((d) => d.x.toFixed(0)).join(','));
  check('in the zone: a forward is at the net', W3.mates(atk).some((m) => m !== fwd && Math.hypot(m.x - (offGoal - 7), m.y - 42.5) < 8));
  const dd = W3.mates('h').filter((m) => m.slot === 3 || m.slot === 4);
  check('defending: a D is in front of the net', dd.some((d) => Math.hypot(d.x - (W3.ownGoal('h') - 8), d.y - 42.5) < 10), dd.map((d) => `${d.x.toFixed(0)},${d.y.toFixed(0)}`).join(' '));
  // through the neutral zone
  fwd.x = 92; fwd.y = 42; hold();
  for (let i = 0; i < 6 / DT; i++) { hold(); fwd.x = Math.min(fwd.x, 100); W3.step(DT); }
  const wings = W3.mates(atk).filter((m) => (m.slot === 0 || m.slot === 2) && m !== fwd);
  check('on the rush: the winger is wide in his lane', wings.length > 0 && wings.every((m) => Math.abs(m.y - 42.5) > 14), wings.map((m) => m.y.toFixed(0)).join(','));
  check('on the rush: nobody is offside', W3.mates(atk).every((m) => m === fwd || (m.x - offBlue) * dir < 2), W3.mates(atk).map((m) => m.x.toFixed(0)).join(','));
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
    ['resurface', () => ice.resurface(119, 50, 0, 121, 50, 0, 3.7), 120, 50],
  ];
  for (const [name, fn, x, y] of marks) {
    fresh(); fn(); ice.flush();
    check(`a ${name} lists its tile`, ice.dirty[tileOf(x, y)] === 1);
    check(`a ${name} lists only nearby tiles`, ice.dirty.reduce((a, v) => a + v, 0) <= 6, `${ice.dirty.reduce((a, v) => a + v, 0)} tiles`);
  }
  fresh(); ice.resurface(119, 50, 0, 121, 50, 0, 3.7);
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
