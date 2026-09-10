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

  // ── TRIM STAYS ON ITS BUILDING ──────────────────────────────────────────
  //
  // The mass faces are compared against the captured shape below, and the flat ones deliberately
  // are not — they are the adornment surfaces and the shape does not carry them. That left the one
  // thing an adornment can do wrong with nothing watching: leave the building entirely. It is the
  // documented authoring hazard ("a coping band floating over its building") and it was also a real
  // renderer bug — the KSAB sound stage and The Coyote's Rest put trim EIGHTEEN TILES out, because
  // `emitFlat` tested MESH_SINK before SHAPE_SINK and the two captures nest.
  //
  // ⚠ IT HAS TO BE THE FIRST CAPTURE OF THE MODEL, WHICH IS WHY IT IS HERE AND NOT IN A PASS OF ITS
  // OWN. That bug only fires on a COLD `shapeForModel` cache, because only the first capture
  // re-enters the arm. Anything appended after the loop below runs warm and sees nothing wrong —
  // which is exactly how the four-facing sweep at the bottom of this file missed it for months.
  //
  // The tolerance is set off what legitimately projects: a balcony and a fire escape reach 0.064
  // tiles past the wall they hang on, a roof tank stands 0.121 above its roof, and the widest
  // authored part in the city is 0.1. Half a tile is far above all of it and two orders below a
  // part that has come off.
  {
    const mass = mesh.filter((f) => f.kind !== 'flat');
    if (mass.length) {
      let X = 0, Y = 0, Z = 0;
      for (const f of mass) for (const p of f.p) { X = Math.max(X, Math.abs(p[0])); Y = Math.max(Y, Math.abs(p[1])); Z = Math.max(Z, p[2]); }
      let outXY = 0, outZ = 0;
      for (const f of mesh) if (f.kind === 'flat') for (const p of f.p) {
        outXY = Math.max(outXY, Math.abs(p[0]) - X, Math.abs(p[1]) - Y);
        outZ = Math.max(outZ, p[2] - Z);
      }
      if (outXY > 0.5) problems.push(`${key}: an adornment surface reaches ${outXY.toFixed(2)} tiles outside the model's own mass — it has come off the building`);
      if (outZ > 0.6) problems.push(`${key}: an adornment surface stands ${outZ.toFixed(2)} tiles above the model's own roof`);
    }
  }

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

// ── A DRUM CARRIES THE COLOUR ITS ARM CHOSE ─────────────────────────────────
//
// A drum's paint is a `style` closure and its capture was the ambient palette, so on the GPU every
// silo, tank, stack, kiln and cupola in the city wore its BUILDING's wall texture — a stainless pot
// on a brick palette is brick. `drawFacetDrum` now asks the style and records the answer as an
// `rgbOverride` + `flat`, and this is the gate on that, because the failure mode is a picture that
// looks fine in isolation: `drumSkin` falls back to the palette when a style cannot be read, which
// is the safe direction in a browser and an invisible one everywhere else.
//
// ⚠ `flat` IS CHECKED WITH THE OVERRIDE AND NOT INSTEAD OF IT. The mass shader samples the atlas
// whenever `solid` is 1, so a face carrying an override and no `flat` has the override ignored
// entirely — which is what the sound-stage sawtooth roof does. Half the fix is not the fix.
//
// The count is taken from `shapeForModel`, which records one drum per solid with its facet count,
// so it is the arm's own statement of how many facets there should be rather than a number this
// file invents. A dome painted as bands captures as ONE drum and meshes as many, so the assertion
// is a floor, not an equality.
// ⚠ THE FLAT RULE IS THE SHADER'S, NOT A GUESS AT IT. `context.js` packs
// `f.flat != null ? !!f.flat : f.kind === 'flat'`, so a `kind: 'flat'` face is already unlit
// without the field. Testing `f.flat` alone reports every adornment surface in the city — 854 of
// them on the first run — which is a gate that fails on the thing it was written to protect.
const isFlat = (f) => (f.flat != null ? !!f.flat : f.kind === 'flat');
const V = (p, fh, h) => (Array.isArray(p) ? p[0] * fh + p[1] * h + p[2] : p);
const palettes = new Set(ws.wallPaletteInfo().map((r) => r.key));
for (const { key, m } of ws.shapeModelRegistry()) {
  const mesh = ws.captureModelMesh(m, { fh: FH, h: H, seed: SEED });
  for (const f of mesh) {
    if (f.rgbOverride && !isFlat(f)) { problems.push(`${key}: a ${f.kind} face carries an rgbOverride but is not flat, so the shader samples the atlas and the override is never read`); break; }
  }
  const drums = (ws.shapeForModel(m, SEED) || []).filter((s) => s.kind === 'drum');
  if (!drums.length) continue;
  const want = drums.reduce((a, d) => a + Math.max(5, d.n || 12) + (d.cap ? 1 : 0), 0);
  const got = mesh.filter((f) => isFlat(f) && f.rgbOverride).length;
  if (got < want) problems.push(`${key}: ${drums.length} drum(s) want at least ${want} faces carrying flat+rgbOverride, the mesh has ${got} — a drum fell back to its building's wall texture`);
  // And the drum's captured palette must exist, or the LOD and the cold open draw it in the
  // fallback grey while the mesh draws it correctly — the same disagreement one layer over.
  for (const d of drums) {
    if (d.pal && !palettes.has(d.pal)) problems.push(`${key}: a drum is captured as palette '${d.pal}', which is not in WALL_COL`);
    if (!(V(d.wz1, FH, H) > V(d.wz0, FH, H))) problems.push(`${key}: a captured drum has no height`);
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
