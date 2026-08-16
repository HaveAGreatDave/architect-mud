// shapes:smoke — execute every flight-sim building model and fail if any of them throws.
//
//   npm run shapes:smoke
//
// Why this exists. The windshield's 72 building models (drawTypeModel in
// client/game/js/panels/windshield.js) had ZERO automated coverage of any kind. The only thing
// that ever ran an arm was a player flying past that particular building, which meant a model
// could be broken for months and nobody would know until someone happened to fly over it.
//
// That is not hypothetical. The Battery Acid Coffee Co. roaster passed `pal` — a palette KEY
// string — where drawFacetDrum's 11th argument must be a style FUNCTION. It threw
// "style is not a function" on the first frame the cafe was visible, which killed the render
// loop and froze the sim with the last frame still painted. Every other drawFacetDrum call in
// the file passes a function; this one outlier shipped because nothing executed it.
//
// WHAT THIS CHECKS, and what it does not. It proves every model RUNS — no exceptions, across
// night and day and both entrance facings. It says nothing about whether a building looks right;
// there is no pixel comparison here and adding one would need a browser. The bar is deliberately
// "the render loop survives", because that is the failure that takes the whole sim down.
//
// Two gates run, both cheap:
//   PAINT   — drawTypeModel + flushFaces() for every model. The flush matters: nearly all the ctx
//             work lives in deferred closures, so a smoke test that skipped it would have sailed
//             straight past the roaster bug.
//   SHAPE   — the capture harness over every model: geometry must be affine in (fh, h) and must
//             reproduce at a scale the decomposition never saw. This is what catches an arm
//             smuggling an absolute constant into a mass argument, which would silently break
//             collision and shadows at any footprint but the captured one.
//
// Runs in node in about a second via scripts/shapes/dom-stub.mjs — no browser, no DB, no network.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { bakeShapes } from './bake.mjs';
import { truckLampSmoke, parkedStanceSmoke, truckNoseSliceSmoke, truckSortStabilitySmoke, LAMP_MIN_AREA } from './truck-lamps.mjs';

const WARN_ONLY = process.argv.includes('--warn-only');

async function main() {
  let ws;
  try {
    ws = await loadWindshield();
  } catch (e) {
    // A load failure is itself a real result: windshield.js is broken, or it grew a dependency on
    // a browser API the stub doesn't answer yet. Both are worth failing on.
    console.error('✗ shapes:smoke — could not load windshield.js:\n ', e.message);
    console.error('\n  If this is a NEW browser API rather than a real bug, add it to scripts/shapes/dom-stub.mjs.');
    process.exit(WARN_ONLY ? 0 : 1);
  }

  const models = ws.shapeModelRegistry();
  const problems = [];

  // ── PAINT ──
  for (const f of ws.shapeRenderSmoke()) {
    problems.push(`paint  ${f.key} (night=${f.night}, ${f.front ? 'entrance toward camera' : 'entrance away'}) → ${f.err}`);
  }

  // ── INTERIOR ──
  // The canopy, the cowl, the passenger window frame and the truck cab. Same rationale as the
  // models above: the only thing that ever runs one of these is somebody sitting in that vehicle,
  // so a throw freezes the sim for exactly one player and is invisible to everyone else.
  const interiors = ws.interiorRenderSmoke();
  for (const f of interiors) {
    problems.push(`interior ${f.key} (hour=${f.hour}, speed=${f.speed}) → ${f.err}`);
  }

  // ── VIEW ──
  // paintWindshield itself, once per view shape. Every other gate here enters BELOW it, so its own
  // entry code — view unpacking, camera solve, pass ordering — had no coverage until a one-line TDZ
  // (`resFloor` read above `const v`) threw on the first line of every paint and blacked out the
  // truck cab, both cockpits and the helm view with this suite still green.
  const WS_ID = '__smoke-ws';
  stubCanvas(WS_ID, 640, 360);
  const views = ws.viewRenderSmoke(WS_ID);
  for (const f of views) problems.push(`view   ${f.key} (hour=${f.hour}, ${f.weather}) → ${f.err}`);

  // ── GROUND COLLISION ──
  // Every model probed at truck height, asserting ground-solid ⊆ air-solid. The two probes share
  // `segContains`; the ground one only ever drops segments that are over the vehicle's head, so a
  // point solid for a truck and hollow for an aircraft means they have drifted apart.
  const ground = ws.groundCollisionSmoke();
  for (const f of ground) problems.push(`ground ${f.key} (ent=${f.ent}) → ${f.err}`);

  // ── TRUCK LAMPS ──
  // Not a building, but the same failure mode the whole file exists for: the only thing that ever
  // looked at a truck's headlamps was a player looking at a truck, and they were invisible twice.
  // See scripts/shapes/truck-lamps.mjs for why this has to render rather than assert on geometry.
  const a3d = await import('../../client/game/js/panels/aircraft3d.js');
  const lamps = truckLampSmoke(a3d.drawHangarScene);
  for (const L of lamps) {
    if (L.left < LAMP_MIN_AREA || L.right < LAMP_MIN_AREA) {
      problems.push(`lamps  ${L.variant} → one-eyed: ${L.left.toFixed(0)}px² visible on the left, `
        + `${L.right.toFixed(0)}px² on the right (min ${LAMP_MIN_AREA}). Something is drawn over a headlamp.`);
    }
  }
  // The same square foot of geometry, one rung more general — see truckNoseSliceSmoke.
  const slices = truckNoseSliceSmoke();
  for (const b of slices) {
    problems.push(`nose   ${b.variant} → a ${b.role} panel at f=${b.plane.toFixed(3)} cuts through a chrome detail `
      + `spanning ${b.detail[0].toFixed(3)}..${b.detail[1].toFixed(3)}. The painter's sort will eat one side of it.`);
  }
  // ── SORT STABILITY ──
  // The temporal half of the question the nose slice asks from four fixed angles: sweep the camera
  // all the way round each rig and count how often each pair of parts trades places. This is the
  // only check in the file that can see the FLASHING, because the flashing is not in the geometry —
  // every box is exactly where it should be, and the bug is which order they are painted in.
  const stab = truckSortStabilitySmoke(ws.sortTruckFaces, ws._resetTruckOrder);
  for (const t of stab) {
    if (t.chattering) {
      problems.push(`sort   ${t.variant} → ${t.chattering} pair(s) of parts trade places more than ${t.max} times `
        + `in one 360° sweep (worst ${t.worst}). That is the flicker: the draw order is not settling.`);
    }
  }
  const stances = parkedStanceSmoke();
  for (const s of stances) {
    if (!(s.drop > 0.008)) problems.push(`parked ${s.variant} → a shut-down rig did not settle (${s.drop.toFixed(4)} of drop)`);
    if (s.sat > 0.006) problems.push(`parked ${s.variant} → it settled but is still off the ground (${s.sat.toFixed(4)})`);
    if (s.through < -0.001) problems.push(`parked ${s.variant} → something sank through the floor (${s.through.toFixed(4)})`);
  }

  // ── SHAPE ──
  let segs = 0, seedVariant = 0;
  const constWarnings = [];
  for (const { key, m } of models) {
    const err = ws.shapeLinearityError(m, 0);
    if (err) { problems.push(`shape  ${key} → ${err}`); continue; }
    const captured = ws.shapeForModel(m, 0);
    if (!captured) { problems.push(`shape  ${key} → capture returned null`); continue; }
    if (!captured.length) problems.push(`shape  ${key} → captured no mass at all (a building with no building)`);
    segs += captured.length;
    if (ws.shapeIsSeedVariant(m)) seedVariant++;
    for (const w of ws.shapeConstantWarnings(m)) constWarnings.push(`${key}: ${w}`);
  }

  // Absolute terms are legal (the Layover's cone apex is a literal 0.001) but they are also what a
  // modelling slip looks like, so they are surfaced rather than swallowed — and never fail the run.
  if (constWarnings.length) {
    console.warn(`! shapes:smoke — ${constWarnings.length} absolute term(s) in mass arguments (legal, but check they're intentional):`);
    for (const w of constWarnings) console.warn(`    ${w}`);
  }

  // ── SOLIDITY ──
  // A building you can SEE must be a building you can HIT. The two answers come from different
  // places — the draw pass keys off `bt`, collision off buildingHeightZ — so they can disagree
  // silently, and did: buildingHeightZ used to let the ground TINT veto a tower's mass, which
  // made every building on a badlands/parkland/water tile a ghost. That is the whole 914/908
  // expansion (no `zone_district_*` arm in districtBiome ⇒ the badlands default), so those
  // towers had no CFIT and the Solenne's rooftop pad had no roof to offer the guidance column.
  // Cheap to state, so it is stated: `bt` decides, and nothing else does.
  const solid = [];
  for (const bi of ['badlands', 'parkland', 'water', 'citycore', 'uptown', undefined]) {
    const tower = { kind: 'land', biome: bi, bt: 'apartment', ent: 'south' };
    if (!(ws.buildingHeightZ(900, 900, tower) > 0)) solid.push(`a building on a '${bi}' tile is not solid`);
    const bare = { kind: 'land', biome: bi, ent: 'south' };
    if (ws.buildingHeightZ(900, 900, bare) !== 0) solid.push(`bare '${bi}' ground extrudes mass`);
  }
  if (ws.buildingHeightZ(900, 900, { kind: 'field', biome: 'airport' }) !== 0) solid.push('a bare apron extrudes mass');
  // The rooftop pad, end to end: the tile the Solenne streams as (a field that carries a building)
  // must answer with a real deck height at its centre — that is the number roofPadProximity
  // requires above zero before it will offer a pad at all.
  const pad = { kind: 'field', biome: 'badlands', bt: 'apartment', bn: 'Solenne Residences', ent: 'south' };
  const padFt = ws.buildingRoofFtAt(914, 908, pad, 914, 908);
  if (!(padFt > 50)) solid.push(`the Solenne's rooftop pad reads ${padFt.toFixed(1)} ft at the tile centre — the pad can never arm`);
  for (const s of solid) problems.push(`solid  ${s}`);

  // ── STALE BAKE ──
  // client/shared/building-shapes.js is generated from these same arms, and the cold open reads it
  // instead of importing the renderer. Because the capture runs in node, this can be a DIRECT
  // comparison rather than a hash of source text: re-capture, compare, and name the models that
  // moved. A hash would only ever say "something changed"; this says what.
  try {
    const baked = await import('../../client/shared/building-shapes.js');
    const fresh = bakeShapes(ws);
    const drifted = [];
    for (const k of new Set([...Object.keys(fresh), ...Object.keys(baked.BUILDING_SHAPES)])) {
      if (JSON.stringify(fresh[k]) !== JSON.stringify(baked.BUILDING_SHAPES[k])) drifted.push(k);
    }
    if (drifted.length) {
      problems.push(`stale bake — ${drifted.length} model(s) differ from client/shared/building-shapes.js `
        + `(${drifted.slice(0, 5).join(', ')}${drifted.length > 5 ? ', …' : ''}). Run: npm run shapes:bake`);
    }
  } catch (e) {
    problems.push(`could not read client/shared/building-shapes.js (${e.message}). Run: npm run shapes:bake`);
  }

  if (problems.length) {
    console.error(`✗ shapes:smoke — ${problems.length} problem(s) across ${models.length} building models:`);
    for (const p of problems) console.error(`    ${p}`);
    console.error('\n  A model that throws takes the whole flight sim down with it, not just itself.');
    process.exit(WARN_ONLY ? 0 : 1);
  }

  // What the distance LOD actually buys, measured rather than asserted: faces queued per building
  // at full detail vs. at range. `detail 1` must equal the arm's own mass (that's the no-pop
  // handover); the drop to `detail 0` is the saving on a distant skyline.
  const at = (d) => models.reduce((s, { m }) => s + ws.shapeLodFaces(m, d), 0) / models.length;
  const full = at(1), mid = at(0.5), far = at(0);
  console.log(`✓ shapes:smoke — ${models.length} models render clean (night/day × both facings, plus the LOD path across 4 detail levels × 4 facings); ${segs} mass segments captured, ${seedVariant} seed-variant.`);
  console.log(`  Interiors: ${interiors.ran} canopy/cowl/window/cab passes clean (night+day × stopped+rolling).`);
  console.log(`  Views: ${views.ran} paintWindshield passes clean (cab/cockpit/chase/porthole/helm × night+day × clear+rain).`);
  console.log(`  Truck lamps: both headlamps visible on all ${lamps.length} rigs (weakest side ${Math.min(...lamps.flatMap(l => [l.left, l.right])).toFixed(0)}px²), and every one settles onto its lifters when parked.`);
  console.log('  Truck noses: no panel cuts through a chrome detail on any of the 4 faces — the grille and the lamp brows survive the sort from either side.');
  console.log(`  Truck sort: ${stab.length} rigs swept 360°, worst pair of parts trades places ${Math.max(...stab.map((t) => t.worst))}× `
    + `(2 is the rigid-body minimum — the old mean-depth sort hit 44, with ${1640} chattering pairs on a full rig).`);
  console.log(`  Ground collision: ${ground.ran} probes at truck height, ${ground.driveUnder} of them mass you drive UNDER (awnings, canopies, overhangs).`);
  console.log(`  LOD faces per building: ${full.toFixed(1)} at full detail → ${mid.toFixed(1)} mid → ${far.toFixed(1)} at range (${(100 - far / full * 100).toFixed(0)}% fewer).`);
  // Cost of the LIGHTS, measured in the two canvas operations that actually hurt. Face count is a
  // bad proxy: a mass face is a flat fill, a neon blade sets shadowBlur (a software blur per draw).
  const cost = (t, f) => models.reduce((a, { m }) => { const c = ws.shapeAdornCost(m, t, 0.9, f); a.g += c.grads; a.b += c.blurs; return a; }, { g: 0, b: 0 });
  const aNear = cost(2, 4), aFar = cost(2, 30), aCheap = cost(1, 4);
  console.log(`  Adornment cost per skyline: tier 2 near ${aNear.g} gradients + ${aNear.b} blurs · tier 2 beyond glowFar ${aFar.g} + ${aFar.b} · tier 1 (beacons/masts) ${aCheap.g} + ${aCheap.b}.`);
  process.exit(0);
}

main();
