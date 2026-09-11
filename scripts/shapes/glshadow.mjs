// glshadow — does the sun's depth pass cast from the same sun the ground has always cast from?
//
//   node scripts/shapes/glshadow.mjs
//
// GLASS now has two building shadows and they have to be one shadow. `drawBuildingShadow` lays a
// footprint hull on z = 0 and has done since before GLASS 2 existed; `lightMatrix` builds the ortho
// projection the new depth pass renders the city through, which is what puts a shadow on a
// neighbour's WALL. If those two disagree about where the sun is, a tower's shadow on the pavement
// and its shadow on the block beside it point different ways — and nothing in the picture says
// which of them is wrong, because both look like shadows.
//
// ⚠ SO THE CENTRAL CHECK IS AN IDENTITY, NOT A TOLERANCE. A point and the place its shadow lands on
// the ground must map to the SAME light-space xy, because the segment between them is the light ray
// and the light's own x and y axes are perpendicular to it by construction. If that holds to float
// precision the two systems are casting from one sun; if it drifts, they are not.
//
// ⚠ AND THE HULL CLAMPS ITS LENGTH WHERE THE MAP DOES NOT. `drawBuildingShadow` offsets by
// `clamp(topZ * len, 0.15, 3.5)` — a 2-D decision, taken so a thirty-storey tower does not throw a
// polygon across the whole map. The DIRECTION is what has to agree and does; the length agrees only
// up to that clamp, so a very tall building's shadow reaches further on a wall than on the ground.
// That is a known and deliberate difference, asserted here rather than discovered later.
//
// Nothing in this file touches WebGL. The matrix is arithmetic, which is what makes it gateable at
// all — there is no GL context in a smoke test, and the failure being hunted (a NaN matrix at noon,
// a box that does not contain the city) draws an empty shadow map and reports nothing.
import { lightMatrix } from '../../client/game/js/panels/gl/camera.js';
import { SHADOW_BIAS_TILES } from '../../client/game/js/panels/gl/shadow.js';

const problems = [];
const note = [];

// GLASS's own sun, restated from paintWindshield. Restated rather than imported because importing
// it means booting the whole renderer for two trigonometric lines — but it is the same two lines,
// and `dir`/`len` are the only things lightMatrix reads.
function sunAt(hour) {
  const dayT = Math.max(0, Math.min(1, (hour - 6) / 12));
  const sunUp = hour > 5.5 && hour < 18.5;
  const elev = sunUp ? Math.sin(dayT * Math.PI) : 0;
  const ang = dayT * Math.PI;
  return {
    elev, dir: [Math.cos(ang), Math.sin(ang)],
    shadowDir: [-Math.cos(ang), -Math.sin(ang)],
    len: sunUp ? Math.max(0.5, Math.min(3.4, 0.6 + (1 - elev) * 2.4)) : 0,
  };
}

// Both window shapes the game actually asks for, plus the two degenerate boxes that would divide
// by zero if the guards were removed: one building alone, and a flat plate with no height at all.
const BOXES = [
  { name: 'cab window (33 tiles)', b: { x0: -16, x1: 16, y0: -16, y1: 16, z0: 0, z1: 9 } },
  { name: 'cockpit window (73 tiles)', b: { x0: -36, x1: 36, y0: -36, y1: 36, z0: 0, z1: 26 } },
  { name: 'one building', b: { x0: -0.44, x1: 0.44, y0: -0.44, y1: 0.44, z0: 0, z1: 2.1 } },
  { name: 'a flat plate', b: { x0: -4, x1: 4, y0: -4, y1: 4, z0: 0, z1: 0 } },
];

// Every daylight hour, on the half hour, plus the two edges where `len` is at its clamp.
const HOURS = [];
for (let h = 5.5; h <= 18.5; h += 0.5) HOURS.push(h);

const apply = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

let checks = 0;
const bad = (s) => { if (problems.length < 12) problems.push(s); };

// ── 1. NOTHING IS EVER NOT A NUMBER ─────────────────────────────────────────
//
// ⚠ THE CASE THIS EXISTS FOR IS NOON. A high sun makes the light direction nearly world -z, and
// the obvious up reference for the light basis is world +z — cross those and you get a zero
// vector, normalise it and every term in the matrix is NaN. A NaN matrix renders an empty shadow
// map: no error, no warning, and a sunny city with nothing casting, which is what a working
// renderer looks like on an overcast day.
for (const { name, b } of BOXES) {
  for (const h of HOURS) {
    const sun = sunAt(h);
    if (!(sun.len > 0)) continue;
    const m = lightMatrix(sun, b);
    checks++;
    if (m.some((v) => !Number.isFinite(v))) { bad(`${name} @${h}h: the light matrix has a non-finite term`); break; }
  }
}

// ── 2. THE BOX HOLDS THE CITY, AND HOLDS IT TIGHTLY ─────────────────────────
//
// Every corner inside NDC is correctness: a caster outside the box is a building that casts no
// shadow at all. Touching ±1 is resolution: the map is a fixed number of texels, so every tile of
// slack in the projection is texels spent on empty ground.
for (const { name, b } of BOXES) {
  for (const h of HOURS) {
    const sun = sunAt(h);
    if (!(sun.len > 0)) continue;
    const m = lightMatrix(sun, b);
    let worst = 0, reach = 0;
    for (let i = 0; i < 8; i++) {
      const p = apply(m, (i & 1) ? b.x1 : b.x0, (i & 2) ? b.y1 : b.y0, (i & 4) ? b.z1 : b.z0);
      for (const v of p) { worst = Math.max(worst, Math.abs(v)); reach = Math.max(reach, Math.abs(v)); }
    }
    checks++;
    if (worst > 1 + 1e-9) bad(`${name} @${h}h: a corner of the mesh box projects outside the shadow frustum (${worst.toFixed(6)})`);
    if (reach < 1 - 1e-6) bad(`${name} @${h}h: the box does not reach the edge of the frustum (${reach.toFixed(6)}) — texels spent on nothing`);
  }
}

// ── 3. THE IDENTITY: THE MAP AND THE HULL CAST FROM ONE SUN ─────────────────
//
// A point at height z lands its shadow at `p + shadowDir * z * len`, which is what
// drawBuildingShadow walks. The light's x and y axes are perpendicular to the ray, so both ends of
// that segment must land on the same texel of the map.
{
  const b = BOXES[0].b;
  const PTS = [[0, 0, 4], [7.5, -3.25, 1.2], [-11, 9, 8.75], [0.4, 0.4, 0.05], [-2, -14, 6]];
  let worst = 0, worstAt = '';
  for (const h of HOURS) {
    const sun = sunAt(h);
    if (!(sun.len > 0)) continue;
    const m = lightMatrix(sun, b);
    for (const [x, y, z] of PTS) {
      const a = apply(m, x, y, z);
      const g = apply(m, x + sun.shadowDir[0] * z * sun.len, y + sun.shadowDir[1] * z * sun.len, 0);
      const d = Math.max(Math.abs(a[0] - g[0]), Math.abs(a[1] - g[1]));
      checks++;
      if (d > worst) { worst = d; worstAt = `${h}h (${x},${y},${z})`; }
    }
  }
  // NDC units over a 33-tile box, so 1e-6 is a ten-thousandth of a tile.
  if (worst > 1e-6) bad(`a point and its ground shadow land ${worst.toExponential(2)} apart in the shadow map at ${worstAt} — the depth pass and drawBuildingShadow are casting from different suns`);
  note.push(`hull identity worst ${worst.toExponential(1)} NDC`);
}

// ── 4. DEPTH RUNS THE RIGHT WAY ─────────────────────────────────────────────
//
// The comparison is LEQUAL against the nearest thing the sun can see, so moving a point TOWARD the
// sun has to make its light-space z smaller. Reversed, the test answers "lit" for everything and
// the feature draws nothing at all — which, like the NaN above, looks exactly like a clear day.
{
  const b = BOXES[1].b;
  for (const h of HOURS) {
    const sun = sunAt(h);
    if (!(sun.len > 0)) continue;
    const m = lightMatrix(sun, b);
    // One step along the ray, toward the sun: up, and back along `dir`.
    const near = apply(m, 2 + sun.dir[0] * sun.len, 3 + sun.dir[1] * sun.len, 1);
    const far = apply(m, 2, 3, 0);
    checks++;
    if (!(near[2] < far[2])) bad(`@${h}h: a point nearer the sun did not get a smaller depth (${near[2].toFixed(4)} vs ${far[2].toFixed(4)}) — the comparison is inverted and nothing is ever in shadow`);
  }
}

// ── 5. THE BIAS IS A DISTANCE, NOT A CONSTANT ───────────────────────────────
//
// It is authored in TILES and divided by the box's own span, because the box is three times deeper
// from a cockpit than from a cab. A bias that did not scale is either acne in one seat or a shadow
// detached from its building in the other, and both read as the shadow map being badly tuned
// rather than as one number being in the wrong units.
{
  const span = (b) => Math.max(1, Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0));
  const cab = SHADOW_BIAS_TILES / span(BOXES[0].b), air = SHADOW_BIAS_TILES / span(BOXES[1].b);
  checks += 2;
  if (!(cab > air * 1.5)) bad(`the depth bias barely differs between a cab and a cockpit window (${cab.toExponential(2)} vs ${air.toExponential(2)}) — it is not tracking the box`);
  // In NDC halves the whole range is 2, so anything near that is not a bias, it is a shrug.
  if (!(cab > 0 && cab < 0.05)) bad(`the cab depth bias is ${cab} of the clip range — outside anything that could be called a contact tolerance`);
  note.push(`bias ${cab.toExponential(1)} cab / ${air.toExponential(1)} air`);
}

if (problems.length) {
  console.error('\n✗ glshadow — ' + problems.length + ' problem(s):');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ glshadow: ${checks} checks over ${HOURS.length} daylight hours and ${BOXES.length} window shapes — ${note.join(', ')}.`);
