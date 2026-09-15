// THE SHADING BEVEL, HELD TO WHAT IT CLAIMS.
//
// Every edge in this city is a hard 90°, because every model is made of boxes and drums and a box
// has no arris. The bevel is the fix, and it is normals only — not one vertex moves — so there is
// nothing about it a geometry gate can see and nothing a face budget would notice. That is exactly
// why it needs its own: a derivation that quietly stopped finding faces would leave the renderer
// unchanged, at full strength, with every uniform correct and every other gate green.
//
// ⚠ COVERAGE IS THE ASSERTION, NOT A STATISTIC. The standing warning in gl/install.js is about
// features that are wired at both ends, gated, swept and doing NOTHING, and it has had to be
// written four times. A floor under the reach is what turns that from a thing somebody notices
// months later into a red push.
//
// ⚠ AND THE VERTEX LAYOUT IS CHECKED STRUCTURALLY, because those offsets are hand-written byte
// counts. An attribute pointed at the wrong offset does not throw: it reads a neighbouring field,
// so the bevel would take its distances from a colour and every wall in the city would be softly
// wrong in a way no gate here compares against.
//
// ⚠ AN EMISSION CHANNEL WAS GATED HERE TOO, AND IS GONE. It measured 0.0% of wall pixels moved at
// every seat and every strength, because every emissive face in the city is a FLAT face and a flat
// face is already unshaded. The account is beside faceEdges in gl/world.js; it is worth reading
// before anybody adds one back.
import { loadWindshield } from './dom-stub.mjs';
import { readFileSync } from 'node:fs';
import { faceEdges } from '../../client/game/js/panels/gl/world.js';

const ws = await loadWindshield();
const FH = 0.4, H = 1, SEED = 3;
const problems = [];

// ── 1. THE VERTEX LAYOUT TILES THE STRIDE EXACTLY ─────────────────────────────
{
  const src = readFileSync('client/game/js/panels/gl/context.js', 'utf8');
  const stride = Number((src.match(/^const STRIDE = (\d+);/m) || [])[1]);
  if (!stride) problems.push('context.js: cannot find the STRIDE declaration');
  const slots = [...src.matchAll(/vertexAttribPointer\(loc\.(\w+), (\d+), gl\.FLOAT, false, S, (\d+)\)/g)]
    .map((m) => ({ name: m[1], size: Number(m[2]), off: Number(m[3]) }));
  if (slots.length < 10) problems.push(`context.js: only ${slots.length} attribute pointers found — the layout scan is not seeing the buffer setup`);
  const used = new Array(stride).fill(null);
  for (const s of slots) {
    if (s.off % 4) { problems.push(`${s.name}: byte offset ${s.off} is not float-aligned`); continue; }
    for (let i = 0; i < s.size; i++) {
      const f = s.off / 4 + i;
      if (f >= stride) { problems.push(`${s.name}: float ${f} runs past STRIDE ${stride}`); break; }
      if (used[f]) problems.push(`${s.name}: float ${f} is already claimed by ${used[f]}`);
      used[f] = s.name;
    }
  }
  const holes = used.map((u, i) => (u ? null : i)).filter((i) => i !== null);
  if (holes.length) problems.push(`the vertex layout leaves float slot(s) ${holes.join(', ')} unread — a field is being written and never bound`);
  console.log(`  · vertex layout: ${slots.length} attributes tiling ${stride} floats with no gap and no overlap`);
}

// ── 2. THE EDGE FIELD, OVER THE WHOLE REGISTRY ────────────────────────────────
let total = 0, quads = 0, nonquad = 0, got = 0, rect = 0, skew = 0, worstArea = 0, models = 0;

for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  const day = ws.captureModelMesh(m, { fh: FH, h: H, seed: SEED });

  day.forEach((f) => {
    total++;
    const isQuad = f.p.length === 4;
    if (isQuad) quads++; else nonquad++;
    const e = faceEdges(f);

    // ⚠ A NON-QUAD MUST GET NOTHING. The shader fills a face with no field with a distance no bevel
    // width can reach, so "null" is what makes a drum cap provably unbeveled rather than
    // approximately unbeveled — and a faceEdges that started answering for triangles would chamfer
    // the whole of every one of them, which reads as the model having gone soft.
    if (!isQuad && e) { problems.push(`${key}: faceEdges answered for a ${f.p.length}-gon`); return; }
    if (!e) return;
    got++;

    for (let v = 0; v < 16; v++) {
      if (!Number.isFinite(e[v])) { problems.push(`${key}: a non-finite edge distance`); return; }
      if (e[v] < 0) { problems.push(`${key}: a negative edge distance (${e[v]})`); return; }
    }

    // ── THE INVARIANTS, CHECKED AGAINST GEOMETRY THIS FUNCTION DID NOT COMPUTE ────────────────
    //
    // Re-deriving the field the same way would be a tautology. What is checked instead is that the
    // field DESCRIBES the face: opposite distances must sum to one constant width at every vertex
    // (which is what makes the field linear, and therefore exact under the triangle fan), every
    // edge must be touched by some vertex, and the width times the height must equal the polygon's
    // own area — taken here from the cross product, which shares no line with faceEdges.
    //
    // ⚠ THE AREA CHECK IS THE ONE THAT EARNED ITS KEEP. faceEdges originally accepted any quad whose
    // vertices each sat on SOME edge of the bounding box, which a trapezoid and a diagonal sliver
    // both pass — and a sliver inscribes a box many times its own area, so the chamfer landed
    // nowhere near the geometry. This put the worst face at 94% wrong and sent the filter back.
    const W = e[0] + e[1], Hh = e[2] + e[3];
    for (let v = 1; v < 4; v++) {
      if (Math.abs(e[v * 4] + e[v * 4 + 1] - W) > 1e-6 || Math.abs(e[v * 4 + 2] + e[v * 4 + 3] - Hh) > 1e-6) {
        problems.push(`${key}: the edge field is not linear — vertex ${v} disagrees about the face's extent`);
        return;
      }
    }
    for (const c of [0, 1, 2, 3]) {
      let lo = Infinity;
      for (let v = 0; v < 4; v++) lo = Math.min(lo, e[v * 4 + c]);
      if (lo > 1e-6) { problems.push(`${key}: no vertex sits on edge ${c} — the field has no zero`); return; }
    }
    let area = 0;
    for (let t = 1; t + 1 < 4; t++) {
      const a = f.p[0], b = f.p[t], c = f.p[t + 1];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    const box = W * Hh;
    // A vertex whose two in-plane distances are both non-zero is not on a corner of the bounding
    // box, so the face is not a rectangle and the distances describe the box rather than the
    // geometry. faceEdges declines those; if one ever gets through, this is what says so.
    let off = 0;
    for (let v = 0; v < 4; v++) {
      off = Math.max(off, Math.min(Math.min(e[v * 4], e[v * 4 + 1]), Math.min(e[v * 4 + 2], e[v * 4 + 3])));
    }
    if (off > 1e-6) skew++; else rect++;
    if (box > 1e-9) worstArea = Math.max(worstArea, Math.abs(box - area) / box);
  });
}

// ── 3. THE FLOORS ────────────────────────────────────────────────────────────
//
// ⚠ THIS IS THE POINT OF THE FILE. The bevel is derived, so the way it breaks is by finding
// nothing — and a renderer with a correct bevel reaching 0 faces is indistinguishable from one with
// the width at 0. Today 32,555 of 37,880 quad faces carry an edge field. The floor sits under that
// rather than on it, because the share moves whenever somebody adds a model with raked or tapered
// geometry and that is not a regression; what would be one is the derivation collapsing.
const quadShare = quads ? got / quads : 0;
if (quadShare < 0.75) problems.push(`only ${(quadShare * 100).toFixed(1)}% of quad faces got an edge field — the bevel is reaching almost nothing`);
if (got < 25000) problems.push(`only ${got} faces carry an edge field (expected over 25,000) — faceEdges has stopped finding the city`);
if (skew) problems.push(`${skew} faces got an edge field without being a rectangle — the filter in faceEdges is letting the bounding-box case through`);
// The tolerance faceEdges itself accepts is 1e-4 of the area, so this is that plus a margin. A
// tighter number here fails on capture float noise and says nothing about the geometry.
if (worstArea > 2e-4) problems.push(`a face's edge field disagrees with its own area by ${(worstArea * 100).toFixed(4)}%`);

console.log(`  · edge field: ${got} of ${quads} quad faces over ${models} models, all of them exact rectangles`);
console.log(`  · declined: ${nonquad} non-quads and ${quads - got} quads that are not rectangles in their own tangent frame (raked, tapered and diagonal faces, where a bounding-box distance is not an edge distance) — worst area disagreement among those kept, ${(worstArea * 100).toFixed(4)}%`);

if (problems.length) {
  console.error(`\n✗ glbevel — ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 20)) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ glbevel: the shading bevel reaches ${got} of ${total} faces over ${models} models, every one of them a true rectangle, with the vertex layout tiling its stride exactly.`);
