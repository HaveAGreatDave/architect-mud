// gllampshadow: the CPU half of the street-lamp shadows (gl/lampshadow.js), as arithmetic.
//
//   node scripts/shapes/gllampshadow.mjs
//
// The maps and the read need a GPU; what decides which lamps get a map and where it looks doesn't,
// and a wrong answer there doesn't throw, it shadows nothing or the wrong lamp's pool. So:
//   1. pickShadowLamps never picks a light that lays no pool (a neon sign, a wash, a doorway lamp),
//      never more than four, and a fourth lamp's weight thins out as a fifth closes on it;
//   2. lampMatrix looks straight down: the lamp's foot is the map's centre, the ground out to
//      `reach` lamp heights is on the map, and the lamp head itself is in front of the near plane;
//   3. buildPropCasters with no light direction lays every slab as an X, so a post casts from
//      any side.
import { pickShadowLamps, lampMatrix, LAMP_SHADOW_TUNE as T, LAMP_SHADOW_MAX } from '../../client/game/js/panels/gl/lampshadow.js';
import { buildPropCasters } from '../../client/game/js/panels/gl/propshadow.js';

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };
const lamp = (x, y, z = 0.33, rgb = [0.45, 0.45, 0.45], extra = {}) => ({ p: [x, y, z], rgbRaw: rgb, ...extra });
const eye = [0, 0, 0.12];

// 1. Picking.
check(pickShadowLamps([lamp(1, 0, 0.33, [0.45, 0.2, 0.1])], eye).length === 0, 'a saturated (neon) light was picked; it lays no pool (POOL_NEON 0)');
check(pickShadowLamps([lamp(1, 0, 0.33, undefined, { wash: true })], eye).length === 0, 'a wash was picked');
check(pickShadowLamps([lamp(1, 0, 0.05)], eye).length === 0, 'a light under minH was picked');
check(pickShadowLamps([lamp(T.far + 1, 0)], eye).length === 0, 'a lamp past `far` was picked');
const row = Array.from({ length: 9 }, (_, i) => lamp(1 + i * 0.8, 0.4));
const got = pickShadowLamps(row, eye);
check(got.length <= LAMP_SHADOW_MAX, `picked ${got.length} lamps, more than ${LAMP_SHADOW_MAX}`);
check(got.every((l) => l.w >= 0 && l.w <= 1), 'a weight outside 0..1');
check(got.length && got[0].p === row[0].p, 'the nearest lamp was not picked first');
const four = pickShadowLamps(row.slice(0, 4), eye);
check(four.length === 4 && four.every((l) => l.w > 0.5), 'with four candidates near the eye, one came out faded or missing');
// A fifth lamp walking in toward the fourth's score: the fourth's weight must fall smoothly to 0.
const base = row.slice(0, 4);
let lastW = 2, smooth = true;
for (let d = 6; d >= 1.5; d -= 0.25) {
  const w4 = (pickShadowLamps([...base, lamp(d, -0.4)], eye).find((l) => l.p === base[3].p) || { w: 0 }).w;
  if (w4 > lastW + 1e-9) smooth = false;
  if (lastW !== 2 && Math.abs(w4 - lastW) > 0.5) smooth = false;
  lastW = w4;
}
check(smooth, 'the fourth lamp\'s weight jumped (or rose) as a fifth closed on it; it should fade');

// 2. The matrix.
const proj = (m, p) => {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return { x: x / w, y: y / w, z: z / w, w };
};
for (const h of [0.14, 0.33, 0.6]) {
  const L = [3.2, -1.7, h], m = lampMatrix(L);
  const foot = proj(m, [L[0], L[1], 0]);
  check(Math.abs(foot.x) < 1e-6 && Math.abs(foot.y) < 1e-6, `h ${h}: the lamp's foot isn't the map's centre (${foot.x}, ${foot.y})`);
  check(foot.z > -1 && foot.z < 1, `h ${h}: the ground under the lamp is outside the depth range (${foot.z})`);
  for (const [dx, dy] of [[1, 0], [0, 1], [-0.7, 0.7]]) {
    const r = T.reach * h, q = proj(m, [L[0] + dx * r, L[1] + dy * r, 0]);
    check(Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.z < 1, `h ${h}: ground at reach (${dx}, ${dy}) is off the map`);
  }
  const head = proj(m, [L[0], L[1], h - 0.005]);
  check(!(head.w > 0 && head.z > -1), `h ${h}: the lamp's own head is inside the map; it would shadow its whole pool`);
}

// 3. The X.
const buf = { data: new Float32Array(64) };
const box = { x0: -2, x1: 2, y0: -2, y1: 2, z0: -0.02, z1: 1 };
const n = buildPropCasters(buf, box, { solids: [[{ actor: 1, x: 0, y: 0, z: 0, s: 0.05 }]], strokes: null, travel: null });
check(n.verts === 12, `a person with no light direction made ${n.verts} vertices, not two slabs (12)`);
let spanX = 0, spanY = 0;
for (let i = 0; i < n.verts; i++) { spanX = Math.max(spanX, Math.abs(buf.data[i * 3])); spanY = Math.max(spanY, Math.abs(buf.data[i * 3 + 1])); }
check(spanX > 0.005 && spanY > 0.005, `the X spans ${spanX.toFixed(4)} by ${spanY.toFixed(4)}; one arm is missing`);
const lit = buildPropCasters(buf, box, { solids: [[{ actor: 1, x: 0, y: 0, z: 0, s: 0.05 }]], strokes: null, travel: [0.6, 0, -0.8] });
check(lit.verts === 6, `with a light direction a person made ${lit.verts} vertices, not one slab (6)`);

if (problems.length) {
  console.error('✗ gl:lampshadow');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('✓ gl:lampshadow: picking skips lights with no pool and fades the fourth lamp out, each map looks straight down from its lamp over `reach` heights of ground, and a slab with no light direction is an X.');
