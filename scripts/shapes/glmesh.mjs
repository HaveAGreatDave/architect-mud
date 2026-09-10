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
let quads = 0, tris = 0, models = 0, flats = 0;
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
  flats += mesh.length - mesh.filter((q) => q.kind !== 'flat').length;

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

  // ⚠ THE ADORNMENT SURFACES ARE NOT COMPARED, AND MUST NOT BE. The mesh carries the flat panels,
  // bands, sills and coping the adornments are built from — `kind: 'flat'` — and adornments are
  // deliberately absent from the captured shape, because a shape is what the city COLLIDES with and
  // a downpipe is not something you can fly into. Holding a mesh that includes them against a shape
  // that excludes them would fail every model that has a canopy, and the fix would have been to stop
  // capturing detail. The mass half is still held to the same tolerance it always was.
  const solid = mesh.filter((q) => q.kind !== 'flat');
  let mz0 = Infinity, mz1 = -Infinity, mr = 0;
  for (const q of solid) {
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

// ── AND THE SAME BUILDING FROM ALL FOUR SIDES ───────────────────────────────
//
// The capture runs the arm at an offset chosen so its ENTRANCE faces the stub camera, because
// sixty arms gate part of what they draw on `frontVis`. That offset has to follow the entrance
// vector, and for a long time it was a fixed step along y — correct for a building facing north
// and wrong for the other three, where the door ended up on the far side and every near-tier
// helper returned early. A shop lost its recessed doorway, glazing and mullions on three facings
// out of four, and nothing anywhere said so: the shape capture only ever runs at [0,1].
//
// A building is the same building whichever way its door faces. So: same face count, same face
// count by kind, and the same extents, at all four.
const FACINGS = [[0, 1], [1, 0], [0, -1], [-1, 0]], FACE_NAME = ['north', 'east', 'south', 'west'];
for (const { key, m } of ws.shapeModelRegistry()) {
  let ref = null;
  for (let i = 0; i < FACINGS.length; i++) {
    const mesh = ws.captureModelMesh(m, { fh: FH, h: H, seed: SEED, E: FACINGS[i] });
    const byKind = {};
    let z0 = Infinity, z1 = -Infinity, r = 0;
    for (const q of mesh) {
      byKind[q.kind] = (byKind[q.kind] || 0) + 1;
      for (const [x, y, z] of q.p) { if (z < z0) z0 = z; if (z > z1) z1 = z; r = Math.max(r, Math.hypot(x, y)); }
    }
    const sig = { n: mesh.length, byKind: JSON.stringify(byKind), z0, z1, r };
    if (!ref) { ref = sig; continue; }
    // ⚠ THE COUNTS ARE EXACT AND THE EXTENTS HAVE A TOLERANCE, and the asymmetry is deliberate. A
    // count is what the vanishing bug shows up as — thirty faces on one facing and none on the
    // other three — and it cannot drift for an innocent reason. An extent can: `draw3DBoxAt` takes a
    // yaw applied in WORLD space, so a yawed box does not turn with the entrance and genuinely
    // reaches a hair further on two facings out of four. That is a property of the arm (see the yaw
    // note in building-shapes.md), not of the capture, and failing on it would mean deleting the
    // check that matters to silence one that does not.
    if (sig.n !== ref.n) problems.push(`${key}: facing ${FACE_NAME[i]} has ${sig.n} faces, facing north has ${ref.n}`);
    else if (sig.byKind !== ref.byKind) problems.push(`${key}: facing ${FACE_NAME[i]} is ${sig.byKind}, facing north is ${ref.byKind}`);
    else if (Math.abs(sig.z1 - ref.z1) > 1e-3 || Math.abs(sig.z0 - ref.z0) > 1e-3) problems.push(`${key}: facing ${FACE_NAME[i]} spans ${sig.z0.toFixed(4)}..${sig.z1.toFixed(4)}, facing north ${ref.z0.toFixed(4)}..${ref.z1.toFixed(4)}`);
    else if (Math.abs(sig.r - ref.r) > 0.05) problems.push(`${key}: facing ${FACE_NAME[i]} reaches ${sig.r.toFixed(3)}, facing north ${ref.r.toFixed(3)}`);
  }
}

for (const p of problems.slice(0, 10)) console.error(`  ✗ ${p}`);
if (problems.length) {
  console.error(`✗ glmesh: ${problems.length} problem(s) across ${models} models.`);
  process.exit(1);
}
const gapText = gaps.size ? [...gaps].map(([k, n]) => `${k} (${n} model${n > 1 ? 's' : ''})`).join(', ') : 'none';
console.log(`✓ glmesh: ${quads} faces (${flats} of them adornment surfaces) / ${tris} triangles over ${models} models, every mass face agreeing with the captured `
  + `shape it collides as, and every model identical at all four entrance facings. Kinds the mesh cannot build yet: ${gapText}.`);
