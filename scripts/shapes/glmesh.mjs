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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const FH = 0.4, H = 1, SEED = 3;
const TOL = 1e-6;

const problems = [];
let quads = 0, tris = 0, models = 0, flats = 0;
const gaps = new Map();
const perModel = new Map();   // key → face count, for the per-model half of the budget below

for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  const mesh = ws.captureModelMesh(m, { fh: FH, h: H, seed: SEED });
  quads += mesh.length;
  perModel.set(key, mesh.length);
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

// ── THE SAME BUILDING AFTER DARK IS THE SAME GEOMETRY ───────────────────────
//
// `tileMesh` captures each model twice — once at noon and once at midnight — and pairs the two
// lists BY INDEX to give every face its day colour and its night colour, so the GPU can cross dusk
// without recapturing geometry or re-baking occlusion. That pairing is only sound because the hour
// changes what a surface is PAINTED and never where it is.
//
// It held for all 173 models when it was written, and nothing enforces it in the renderer: a model
// that ever made its face count or its face ORDER depend on the hour would hand every building in
// the frame somebody else's colours, and the picture would look like a palette bug rather than like
// a capture bug. world.js falls back to day-only on a length mismatch, which is safe and silent —
// so this is the thing that says it out loud.
//
// ⚠ THE ORDER IS CHECKED, NOT JUST THE COUNT. Equal counts in a different order is exactly the case
// the length guard cannot see.
for (const { key, m } of ws.shapeModelRegistry()) {
  const day = ws.captureModelMesh(m, { fh: FH, h: H, seed: SEED, E: [0, 1], night: 0 });
  const nite = ws.captureModelMesh(m, { fh: FH, h: H, seed: SEED, E: [0, 1], night: 1 });
  if (day.length !== nite.length) { problems.push(`${key}: ${day.length} faces by day and ${nite.length} by night — the day/night colour pairing is by index`); continue; }
  for (let i = 0; i < day.length; i++) {
    const a = day[i], b = nite[i];
    if (a.kind !== b.kind) { problems.push(`${key}: face ${i} is ${a.kind} by day and ${b.kind} by night — the capture order depends on the hour`); break; }
    if (a.p.length !== b.p.length) { problems.push(`${key}: face ${i} has ${a.p.length} points by day and ${b.p.length} by night`); break; }
    let moved = 0;
    for (let v = 0; v < a.p.length; v++) for (let c = 0; c < 3; c++) moved = Math.max(moved, Math.abs(a.p[v][c] - b.p[v][c]));
    if (moved > TOL) { problems.push(`${key}: face ${i} (${a.kind}) moves ${moved.toFixed(6)} between day and night — geometry must not depend on the hour`); break; }
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

// ── `face: 'x'` PUTS A PART ON A FLANK, AND NOT ON THE FRONT ────────────────
//
// `detailLayer` mounts a side-faced part by rotating the whole local frame a right angle — it hands
// the painter an `E` turned −90° and an `F` built from it, so all 23 painters work unmodified. That
// is a good mechanism and a completely silent one to get backwards: a part on the wrong flank, or
// still on the front, draws perfectly and identically every frame. `anchored.mjs` cannot see this —
// it reads the authored JSON in `content/building_models/`, and the parts that use this are DERIVED.
//
// So: a synthetic building, one pipe mounted the default way and one with `face: 'x'`, and the two
// must come out on perpendicular walls. The derived kit is switched off for it so the only parts in
// the mesh are the two being asked about.
{
  const T = ws.RENDER_TUNE, wasKit = T.derivedKit;
  try {
    T.derivedKit = 0;
    const A = (v) => [0, 0, v];
    const box = { kind: 'box', cx: A(0), cy: A(0), hwRaw: A(0.4), fdRaw: A(0.4), z0: A(0), z1: A(0.6), roof: true, yaw: 0, pal: 'citycore' };
    const pipe = (face) => ({ kind: 'pipe', face, cx: A(0), cy: A(face === 'x' ? 0.4 : 0.4), z0: A(0.05), z1: A(0.55), r: A(0.02), pal: 'infra' });
    const mk = (face) => ({ type: 'authored', pal: 'citycore', segs: [box], adorn: [], detail: [pipe(face)] });
    const spanOf = (m) => {
      const mesh = ws.captureModelMesh(m, { fh: FH, h: H, seed: SEED, E: [0, 1] });
      // The pipe is the only flat geometry on the model; the box contributes walls and a roof.
      const flat = mesh.filter((f) => (f.flat != null ? !!f.flat : f.kind === 'flat'));
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const f of flat) for (const [x, y] of f.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return { n: flat.length, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    };
    const front = spanOf(mk(undefined)), side = spanOf(mk('x'));
    if (!front.n || !side.n) {
      problems.push('the face-rotation check drew no adornment geometry at all — the synthetic model is wrong, not the renderer');
    } else {
      // The default pipe sits on a y wall: |y| large, |x| ~0. The side pipe must be the other way
      // round. Comparing the two rather than testing absolutes keeps this honest if the capture
      // offset ever changes.
      if (!(Math.abs(front.y) > Math.abs(front.x))) problems.push(`face-rotation: the DEFAULT pipe is not on a y wall (centroid x ${front.x.toFixed(3)}, y ${front.y.toFixed(3)})`);
      if (!(Math.abs(side.x) > Math.abs(side.y))) problems.push(`face: 'x' put a part on the front, not on a flank (centroid x ${side.x.toFixed(3)}, y ${side.y.toFixed(3)}) — the frame rotation in detailLayer is wrong`);
      if (front.n !== side.n) problems.push(`face-rotation: the same part drew ${front.n} faces on the front and ${side.n} on the flank — a rotation must not change how much geometry a part has`);
    }
  } finally { T.derivedKit = wasKit; }
}

// ── GOING RICH MAY ADD, AND MAY NOT TAKE AWAY ───────────────────────────────
//
// `derivedKit` pushes its sections in the order a street reads them — windows, riser, stair, roof,
// ground floor, name board, pavement — and every one of them shares ONE `spent` counter against
// `KIT_MAX`. So a section that grows does not merely cost more: it silently consumes the sections
// that come after it, and the only symptom is a building quietly missing something.
//
// That is not hypothetical. Raising the rich ceilings for the mesh took two buildings' `signBoard`
// away — the board carrying the building's own name — and paid for it in thirty-four extra window
// bays, which is a bad trade in any city. Nothing printed a number that moved.
//
// So: whatever the rich kit does, a model may not come out of it having LOST a section it had in
// the lean one. The window grid's own sub-budget is what keeps this true; this is what notices if
// somebody removes it.
{
  const SECTION = {
    windowBay: 'wall', louvreBank: 'wall',
    pipe: 'riser', cableRun: 'riser', ductRun: 'riser',
    fireEscape: 'stair', balcony: 'stair',
    roofTank: 'roof', antennaCluster: 'roof', tankFrame: 'roof', stack: 'roof',
    canopy: 'ground', shutter: 'ground', signBoard: 'sign',
    streetLamp: 'street', bollard: 'street', vendingMachine: 'street', parapet: 'cope',
  };
  const sections = (list) => new Set((list || []).map((d) => SECTION[d.kind]).filter(Boolean));
  for (const { key, m } of ws.shapeModelRegistry()) {
    // ⚠ `forceRich`, because the rich list is chosen by MESH_SINK and only `captureModelMesh` sets
    // it — there is otherwise no way to ask what the mesh was built from.
    const lean = sections(ws.derivedTrim(m, FH, H, SEED, false));
    const rich = sections(ws.derivedTrim(m, FH, H, SEED, true));
    const lost = [...lean].filter((s) => !rich.has(s));
    if (lost.length) problems.push(`${key}: the rich kit LOST ${lost.join(', ')} — a section that fits in the lean budget must fit in the bigger one; something earlier in derivedKit is eating the counter`);
  }
}

// ── AND THE BIG SIGNS HAVE TO REACH THE CITY ────────────────────────────────
//
// A FLOOR, not a band, and the difference is the whole point. `signGantry` and `bladePanel` are
// rationed by a seeded roll whose rate is chosen per style, and the rates were first set against
// the style mix of the REGISTRY — 66 front / 47 block / 56 works over all 173 models. That is the
// wrong population: the models the kit signs at all are the ones whose arms did NOT, and almost
// every shopfront arm signs its own facade. Six of the ninety-nine models that reach the sign
// section are `front`, so rates picked for the registry produced 16 roof armatures and TWO blades
// across the whole city — and nothing anybody prints moved, because a face budget is an upper
// bound and a composition check only notices a section that is LOST rather than one that was
// never reached.
//
// ⚠ SO THIS IS DELIBERATELY NOT A TUNING ASSERTION. The floors are far below where the rates sit,
// so retuning them is free and only a change that quietly takes the feature back to almost nothing
// trips it. A gate that pinned the rate would fail on every retune, which is the objection
// `models:quality` records against gating itself.
{
  // ⚠ THE TWO BLADES ARE COUNTED APART, because they are two features wearing one kind. A corner
  // blade has no `face`; a gable-end ad panel is `face: 'x'`. Counted together, 66 ad panels would
  // hide a corner blade that had regressed to two — which is the exact failure this gate was
  // written for and was catching before the ad panel existed.
  // ⚠ THE PLINTH IS COUNTED BY ITS HEIGHT, NOT BY ITS KIND OR ITS COUNT. A plinth, a crown course
  // and the roof coping are all the `parapet` kind, so "has a parapet" and even "has two" were
  // already true of most models before section 5 existed — deleting the whole section left 118 of
  // them still passing a two-or-more test, which is a gate that cannot fail. What is unique to the
  // plinth is WHERE it is: a band at the foot of the mass. Nothing else in the vocabulary puts one
  // at z ~ 0, and the nearest authored parapet in any arm list sits at 0.198.
  // ⚠ `parapet` is square-only (one half-width, four sides), which is the thing that can quietly
  // take this to nothing: a change to how the candidate boxes are measured turns 163 square bases
  // into a handful, the plinth silently stops being pushed, and no face budget would notice.
  const FLOOR = { roofArmature: 25, cornerBlade: 8, gableAd: 15, plinth: 75 };
  const OF = {
    roofArmature: (d) => d.kind === 'signGantry',
    cornerBlade: (d) => d.kind === 'bladePanel' && d.face !== 'x',
    gableAd: (d) => d.kind === 'bladePanel' && d.face === 'x',
  };
  const seen = { roofArmature: 0, cornerBlade: 0, gableAd: 0, plinth: 0 };
  let i = 0;
  for (const { m } of ws.shapeModelRegistry()) {
    // Seeds vary per tile in the game, so a single seed would measure one roll rather than a rate.
    const list = ws.derivedTrim(m, FH, H, (i++ * 13 + 5) % 101, true) || [];
    for (const k of Object.keys(OF)) if (list.some(OF[k])) seen[k]++;
    if (list.some((d) => d.kind === 'parapet' && V(d.z, FH, H) <= 0.02)) seen.plinth++;
  }
  for (const [k, floor] of Object.entries(FLOOR)) {
    if (seen[k] < floor) problems.push(`only ${seen[k]} of 173 models get a ${k} (floor ${floor}) — the derived kit has stopped reaching the city with it; check the rates and gates in derivedKit sections 4 and 5 against which models actually have `+"`wants`"+` open, and against the shape of the boxes they are placed on`);
  }
  console.log(`  · big signage reaches ${seen.roofArmature} roof armatures, ${seen.cornerBlade} corner blades and ${seen.gableAd} gable ads over 173 models`);
  console.log(`  · ${seen.plinth} models meet the pavement with a plinth rather than with a bare wall`);
}

// ── THE FACE BUDGET ─────────────────────────────────────────────────────────
//
// The rich detail kit is bounded by five constants in `derivedKit` and by nothing else. Raising one
// of them is a two-character edit whose whole effect is a number nobody looks at: the picture is
// better, the frame is fine, the buffer is uploaded once, and the cost lands somewhere nobody is
// watching — on the COLD capture, where `bakeFaceAO` runs 9 directions × 2 reaches per vertex and
// the first capture of a model is the one that happens as that building comes into view.
//
// So the total is committed, the same way `framecost` commits canvas calls, with the same
// discipline: `--write` re-blesses it, and re-blessing is a visible diff that wants a reason.
//
// ⚠ THE PER-MODEL CEILING IS THE HALF THAT MATTERS. A total can absorb one arm going mad — The
// Meridian Lobby alone is 2,711 faces, 7.6% of the city — so the cap catches a single model
// running away while the total is still comfortably inside its budget.
{
  const BUDGET = new URL('./glmesh.budget.json', import.meta.url);
  const write = process.argv.includes('--write');
  const now = { total: quads, worst: Math.max(0, ...perModel.values()), worstKey: '' };
  for (const [k, n] of perModel) if (n === now.worst) { now.worstKey = k; break; }
  if (write) {
    writeFileSync(BUDGET, JSON.stringify({ total: now.total, perModel: now.worst, worstKey: now.worstKey, note: 'npm run gl:mesh -- --write re-blesses this. Say why in the commit.' }, null, 2) + '\n');
    console.log(`  · budget re-blessed: ${now.total} faces total, ${now.worst} on ${now.worstKey}`);
  } else if (existsSync(BUDGET)) {
    const want = JSON.parse(readFileSync(BUDGET, 'utf8'));
    // ⚠ THE TOLERANCE IS SET OFF WHAT A NEW MODEL COSTS, NOT OFF A ROUND NUMBER. The mean model is
    // 205 faces, so one added building is 0.6% of the total: 3% leaves room for about five of them
    // before somebody has to re-bless, and still catches a ceiling being raised. The first cut used
    // 6% and let a swept `COL_PITCH_RICH` of 0.05 — 36,868 faces, half again the density anybody
    // asked for — through at +3.9%, which is the whole failure this is here to prevent.
    if (now.total > want.total * 1.03) problems.push(`the mesh is ${now.total} faces against a budget of ${want.total} (+${(100 * (now.total / want.total - 1)).toFixed(1)}%) — raise the budget deliberately with --write, or find what grew`);
    if (now.worst > want.perModel * 1.10) problems.push(`${now.worstKey} is ${now.worst} faces against a per-model budget of ${want.perModel} — one arm has run away`);
  } else {
    console.log('  · no committed face budget yet — run `node scripts/shapes/glmesh.mjs --write` to set one');
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
