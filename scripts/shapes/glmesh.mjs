// Does the GL mesh describe the same building the sim collides with?
//
// The spike's second question. `captureModelMesh` runs the real model arm with MESH_SINK set, so
// the vertices come out of the same primitives that paint the 2-D picture and cannot be a second
// opinion about shape. What that does NOT prove is that the mesh agrees with the OTHER reading of
// the same building — the captured segments (`shapeForModel`), which are what CFIT collision, the
// truck's ground probe, the ground shadows, the occlusion hulls and the cold open all use.
//
// Those two must describe one building. This compares their extents, model by model, and reports
// the geometry the mesh cannot yet express rather than letting it go missing quietly: barrel roofs,
// sawtooth roofs and the two hand-rolled shells build their faces inside their own helpers instead
// of through the box and drum primitives, so a model made of them would silently arrive empty.
//
// ⚠ COVERAGE IS PART OF THE RESULT. A spike that skipped a tenth of the city would measure a cost
// that is not the real one, and would look faster for the wrong reason.
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const FH = 0.4, H = 1, SEED = 3;
const TOL = 1e-6;

const problems = [];
let quads = 0, tris = 0, models = 0;
const gaps = new Map();

for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  const mesh = ws.captureModelMesh(m, { fh: FH, h: H, seed: SEED });
  quads += mesh.length;
  tris += mesh.reduce((a, q) => a + (q.p.length - 2), 0);

  // Every vertex finite. A NaN here would draw nothing and throw nothing — the same silent failure
  // the adornment gate exists for, one layer down.
  for (const q of mesh) {
    if (q.p.some((p) => p.some((n) => !Number.isFinite(n)))) { problems.push(`${key}: a mesh face has a non-finite vertex`); break; }
  }
  if (!mesh.length) { problems.push(`${key}: no mesh at all`); continue; }

  // The captured shape, resolved at the same basis the mesh was built at.
  const segs = ws.shapeForModel(m, SEED) || [];
  const V = (p) => p[0] * FH + p[1] * H + p[2];
  let sz0 = Infinity, sz1 = -Infinity, sr = 0;
  let kinds = new Set();
  for (const s of segs) {
    kinds.add(s.kind);
    const z0 = V(s.z0), z1 = V(s.z1);
    if (z0 < sz0) sz0 = z0;
    if (z1 > sz1) sz1 = z1;
    const cx = V(s.cx), cy = V(s.cy);
    // ⚠ A BOX REACHES ITS CORNER, NOT ITS FACE. The first cut used max(hw, fd) and reported 134 of
    // 173 models as too wide by ~0.18 — which is exactly 0.44·(√2 − 1), i.e. the test measuring a
    // half-width where the mesh measures a diagonal.
    const half = s.kind === 'drum' ? Math.max(V(s.rb), V(s.rt))
      : s.kind === 'box' ? Math.hypot(Math.min(V(s.hwRaw), 0.44), Math.min(s.fdRaw ? V(s.fdRaw) : V(s.hwRaw), 0.44))
        : Math.max(Math.abs(V(s.hx ?? [0, 0, 0])), Math.abs(V(s.hw ?? [0, 0, 0])));
    sr = Math.max(sr, Math.hypot(cx, cy) + half);
  }

  let mz0 = Infinity, mz1 = -Infinity, mr = 0;
  for (const q of mesh) {
    for (const [x, y, z] of q.p) {
      if (z < mz0) mz0 = z;
      if (z > mz1) mz1 = z;
      mr = Math.max(mr, Math.hypot(x, y));
    }
  }

  // The mesh may be SHORTER than the captured shape when a kind it cannot build is the tallest
  // thing on the model — that is the coverage gap, reported below rather than failed here. What it
  // may never be is TALLER or WIDER than the shape the rest of the engine reads, because that is a
  // building whose picture is bigger than its collision.
  // Every kind the mesh sink knows how to record. A kind outside this list has no vertices at
  // all, and the model it appears on is reported as a coverage gap rather than compared.
  const MESHED = ['box', 'drum', 'barrel', 'sawtooth'];
  const buildable = [...kinds].every((k) => MESHED.includes(k));
  if (mz1 > sz1 + TOL) problems.push(`${key}: the mesh stands ${(mz1 - sz1).toFixed(4)} taller than the captured shape`);
  if (mr > sr + 0.02) problems.push(`${key}: the mesh reaches ${(mr - sr).toFixed(4)} wider than the captured shape`);
  if (buildable) {
    if (Math.abs(mz1 - sz1) > 1e-3) problems.push(`${key}: mesh top ${mz1.toFixed(4)} vs captured ${sz1.toFixed(4)}`);
    if (Math.abs(mz0 - sz0) > 1e-3) problems.push(`${key}: mesh base ${mz0.toFixed(4)} vs captured ${sz0.toFixed(4)}`);
  } else {
    for (const k of kinds) if (!MESHED.includes(k)) gaps.set(k, (gaps.get(k) || 0) + 1);
  }
}

for (const p of problems.slice(0, 10)) console.error(`  ✗ ${p}`);
if (problems.length) {
  console.error(`✗ glmesh: ${problems.length} problem(s) across ${models} models.`);
  process.exit(1);
}
const gapText = gaps.size ? [...gaps].map(([k, n]) => `${k} (${n} model${n > 1 ? 's' : ''})`).join(', ') : 'none';
console.log(`✓ glmesh: ${quads} faces / ${tris} triangles over ${models} models, every one agreeing with the captured `
  + `shape it collides as. Kinds the mesh cannot build yet: ${gapText}.`);
