// glao — the baked per-vertex occlusion: is it finite, is it deterministic, and is it still there?
//
// ⚠ THIS TERM'S FAILURES ARE ALL QUIET ONES. It is a multiply in the mass shader, so every way it
// can be wrong still draws a city at full speed:
//
//   A NaN vertex spreads through the multiply and paints black or paints nothing.
//   A bake that finds nothing bakes 1.0 everywhere, which is indistinguishable from strength 0.
//   A bake that finds everything bakes 0.0 everywhere, which reads as a dark exposure setting.
//   A non-deterministic sample pattern makes the same building two different buildings, and
//     `models:diff` cannot see it because AO is not a drawing operation.
//
// And the sampling is NARROWED — a face only tests the segments its own range check found — which
// is a 2.8x saving on the worst model in the city and has to be provably a no-op on the picture.
// That equivalence is the check this file exists for most.
//
//   node scripts/shapes/glao.mjs
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const { captureModelMesh, modelSolid, shapeModelRegistry, RENDER_TUNE } = ws;
const { bakeFaceAO } = await import('../../client/game/js/panels/gl/world.js');

const FH = 0.9, H = 1.0, SEED = 7;
let checks = 0, bad = 0;
const check = (cond, what) => { checks++; if (!cond) { bad++; if (bad <= 12) console.error('  ✗ ' + what); } };

const fresh = (m) => captureModelMesh(m, { fh: FH, h: H, seed: SEED }).map((f) => ({ ...f, p: f.p.map((p) => p.slice()) }));

let verts = 0, occluded = 0, open = 0, sum = 0, models = 0, noSolid = 0;
let equivCmp = 0, equivDiff = 0, detDiff = 0;
let worstMs = 0, worstKey = '', totalMs = 0;

for (const { key, m } of shapeModelRegistry()) {
  const solid = modelSolid(m, SEED, FH, H);
  if (!solid) { noSolid++; continue; }
  models++;
  check(Array.isArray(solid.bounds) && solid.bounds.length > 0, `${key}: modelSolid gave no segment bounds to narrow by`);

  const a = fresh(m);
  const t = Date.now(); bakeFaceAO(a, solid); const ms = Date.now() - t;
  totalMs += ms; if (ms > worstMs) { worstMs = ms; worstKey = key; }

  for (const f of a) {
    if (f.ao == null) { verts += f.p.length; open += f.p.length; sum += f.p.length; continue; }
    check(f.ao.length === f.p.length, `${key}: a face has ${f.p.length} vertices and ${f.ao.length} occlusion values`);
    for (const v of f.ao) {
      verts++; sum += v;
      if (!Number.isFinite(v)) { check(false, `${key}: a vertex baked a non-finite occlusion value`); break; }
      if (v < -1e-9 || v > 1 + 1e-9) { check(false, `${key}: a vertex baked ${v}, outside 0..1`); break; }
      if (v < 0.999) occluded++; else open++;
    }
  }

  // ── THE SAME MODEL BAKES THE SAME WAY TWICE ────────────────────────────────────────────────
  const b = fresh(m); bakeFaceAO(b, solid);
  for (let i = 0; i < a.length; i++) for (let v = 0; v < a[i].p.length; v++) {
    if ((a[i].ao ? a[i].ao[v] : 1) !== (b[i].ao ? b[i].ao[v] : 1)) detDiff++;
  }

  // ── AND NARROWING THE SAMPLE SET CHANGES NOTHING ───────────────────────────────────────────
  // A predicate with no `.bounds` cannot be narrowed, so this is the full every-segment scan.
  // ⚠ It is also the case that would silently bake the whole city open if the narrowed list were an
  // empty array rather than null — "test these zero segments" instead of "test all of them".
  const c = fresh(m); bakeFaceAO(c, (x, y, z) => solid(x, y, z));
  for (let i = 0; i < a.length; i++) for (let v = 0; v < a[i].p.length; v++) {
    equivCmp++;
    if ((a[i].ao ? a[i].ao[v] : 1) !== (c[i].ao ? c[i].ao[v] : 1)) equivDiff++;
  }
}

check(detDiff === 0, `${detDiff} vertices bake differently on a second run — the sample pattern is not deterministic`);
check(equivDiff === 0, `${equivDiff} of ${equivCmp} vertices differ between the narrowed sampling and the full scan`);

// ── NOT INERT, AND NOT A BLANKET ───────────────────────────────────────────────────────────────
// The two ways this lands as a plausible non-feature. Bands are wide on purpose: they are here to
// catch a term that has stopped working, not to pin an art direction.
const share = occluded / verts, mean = sum / verts;
check(share > 0.15, `only ${(share * 100).toFixed(1)}% of vertices carry any occlusion — the bake has stopped finding geometry`);
check(share < 0.85, `${(share * 100).toFixed(1)}% of vertices are occluded — this is an exposure change wearing occlusion's name`);
check(mean > 0.55 && mean < 0.98, `mean openness ${mean.toFixed(3)} is outside the band a city of mostly-open walls should sit in`);

// A model whose shape will not capture must get NO term rather than a wrong one.
check(modelSolid(null, 0, FH, H) === null, 'modelSolid should refuse a missing model rather than answer for it');
{
  const f = [{ kind: 'wall', n: [0, -1, 0], p: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]] }];
  bakeFaceAO(f, () => false);
  check(f[0].ao && [...f[0].ao].every((v) => v === 1), 'a face with nothing solid anywhere near it should bake fully open');
  const g = [{ kind: 'wall', n: [0, -1, 0], p: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]] }];
  bakeFaceAO(g, () => true);
  check(g[0].ao && [...g[0].ao].every((v) => v === 0), 'a face buried in solid should bake fully closed');
}
// ⚠ A zero-length normal comes out of a degenerate captured face and is a NaN factory — the same one
// that painted 10% of the city black through the sun's slope bias. The frame it builds here must not
// collapse onto the normal either, or the model bakes a uniform grey that reads as a strength.
{
  const f = [{ kind: 'flat', n: [0, 0, 0], p: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] }];
  bakeFaceAO(f, () => false);
  check(f[0].ao && [...f[0].ao].every(Number.isFinite), 'a face with a zero-length normal should still bake finite values');
}

console.log(`  · ${models} models baked${noSolid ? ` (${noSolid} with no capturable shape, skipped)` : ''}, `
  + `${verts} vertices: ${(share * 100).toFixed(1)}% carry occlusion, mean openness ${mean.toFixed(3)}`);
console.log(`  · ${totalMs} ms for the whole registry, worst single model ${worstMs} ms (${worstKey.replace('named:', '')})`
  + ` — paid once per model, inside the tileMesh memo`);
console.log(`  · strength ships at RENDER_TUNE.glBakedAo = ${RENDER_TUNE.glBakedAo}`);

if (bad) {
  console.error(`\n✗ glao — ${bad} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`✓ glao: ${checks} checks — the occlusion bake is finite, deterministic, unchanged by its own sample narrowing, and still finding corners.`);
