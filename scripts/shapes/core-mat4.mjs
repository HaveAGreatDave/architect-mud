// core-mat4: the shared matrix sums (client/game/js/panels/gl/core/mat4.js) against the copies
// they replace (docs/proposals/gl-core.md).
//
//   node scripts/shapes/core-mat4.mjs
//
// A renderer moved onto gl/core must draw the same picture it drew before, so:
//   1. multiply, invert, perspective and lookAt give the same numbers to the last bit as the copies
//      they replaced, kept here as frozen reference;
//   2. `out` works, including when it's one of the inputs;
//   3. lampMatrix and spotMatrix, which now take their angle in radians, agree with the old degree
//      round trip to a part in 10^12.
// When a live copy goes, move it into the frozen block below rather than dropping the check.
import { multiply, invert, perspective, lookAt } from '../../client/game/js/panels/gl/core/mat4.js';
import * as D from '../../client/game/js/panels/diamond/camera.js';
import { DEG } from '../../client/game/js/panels/diamond/geo.js';
import { lampMatrix, LAMP_SHADOW_TUNE } from '../../client/game/js/panels/gl/lampshadow.js';
import { spotMatrix, spotReach } from '../../client/game/js/panels/gl/spotshadow.js';

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };
let seed = 11;
const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rnd = (k = 10) => (R() - 0.5) * 2 * k;
const mat = () => Array.from({ length: 16 }, () => rnd());
const vec = (k) => [rnd(k), rnd(k), rnd(k)];
const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol * Math.max(1, Math.abs(b[i])));

// ── the retired copies, frozen ────────────────────────────────────────────────────────────────────
// gl/camera.js multiply, rink/camera.js mul and kitchen.js mat4mul were this loop, word for word.
function oldMultiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
// taa.js and cloudvol.js invert4.
function oldInvert(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
}

// diamond/camera.js perspective, lookAt, mul4 and inv4, retired 2026-11-16 (lookAt still reads its live axes()).
function oldDPerspective(fov, aspect, near, far) {
  const t = 1 / Math.tan(fov * DEG / 2), nf = 1 / (near - far);
  return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function oldDLookAt(e, c) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const { r: x, u: y, f } = D.axes({ eye: e, at: c }), z = [-f[0], -f[1], -f[2]];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
}
function oldDMul4(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}
function oldDInv4(a) {
  const o = new Array(16);
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
  const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6], b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
  const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
  o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
  o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
  o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
  o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  return o;
}

// 1. Bit for bit.
for (let i = 0; i < 2000; i++) {
  const a = mat(), b = mat();
  const m = multiply(a, b);
  check(same(m, oldMultiply(a, b)), 'multiply differs from the retired loop');
  check(same(m, oldDMul4(a, b)) && same(m, D.mul4(a, b)), 'multiply differs from the retired diamond mul4');
  const inv = invert(a), old = oldInvert(a);
  check(inv && old && same(inv, old), 'invert differs from the retired invert4');
  check(inv && same(inv, oldDInv4(a)) && same(inv, D.inv4(a)), 'invert differs from the retired diamond inv4');
  const fov = 5 + R() * 100, aspect = 0.5 + R() * 2, n = 0.1 + R() * 5, f = n + 1 + R() * 900;
  check(same(perspective(fov * DEG, aspect, n, f), oldDPerspective(fov, aspect, n, f)) && same(D.perspective(fov, aspect, n, f), oldDPerspective(fov, aspect, n, f)), 'perspective differs from the retired diamond copy');
  const eye = vec(100), at = vec(100);
  check(same(lookAt(eye, at), oldDLookAt(eye, at)) && same(D.lookAt(eye, at), oldDLookAt(eye, at)), 'lookAt differs from the retired diamond copy');
}
check(invert(new Array(16).fill(0)) === null, 'invert of a singular matrix is not null');

// 2. out, aliased or not.
{
  const a = mat(), b = mat(), want = multiply(a, b);
  const out = new Float64Array(16);
  check(multiply(a, b, out) === out && same(Array.from(out), want), 'multiply into out');
  const a2 = a.slice();
  check(same(multiply(a2, b, a2), want), 'multiply with out === a');
  const b2 = b.slice();
  check(same(multiply(a, b2, b2), want), 'multiply with out === b');
  const i2 = a.slice(), wantI = invert(a);
  check(same(invert(i2, i2), wantI), 'invert in place');
  check(multiply(a, b) !== multiply(a, b), 'two calls without out share an array');
}

// 3. The shadow matrices, against the degree round trip they used to make.
for (let i = 0; i < 500; i++) {
  const p = [rnd(50), rnd(50), 0.5 + R() * 8], T = LAMP_SHADOW_TUNE, h = Math.max(0.05, p[2]);
  const old = D.mul4(D.perspective(2 * Math.atan(T.reach * 1.05) * 180 / Math.PI, 1, Math.min(T.near, h * 0.5), h + 0.05),
    D.lookAt([p[0], p[1], p[2]], [p[0], p[1], p[2] - 1]));
  check(near(lampMatrix(p), old, 1e-12), 'lampMatrix moved in the move to radians');
  const lamp = [rnd(80), 20 + R() * 40, rnd(80)], focus = [rnd(20), 0, rnd(20)], radius = 5 + R() * 30;
  const d = Math.hypot(focus[0] - lamp[0], focus[1] - lamp[1], focus[2] - lamp[2]), r = spotReach(lamp, focus, radius);
  const sfov = 2 * Math.asin(Math.min(0.999, r * 1.05 / d)) * 180 / Math.PI, sn = Math.max(1, d - r * 1.5);
  const sold = D.mul4(D.perspective(sfov, 1, sn, d + r * 1.5), D.lookAt(lamp, focus));
  check(near(spotMatrix(lamp, focus, radius), sold, 1e-12), 'spotMatrix moved in the move to radians');
}

const uniq = [...new Set(problems)];
if (uniq.length) {
  console.error('core-mat4: ' + problems.length + ' failures');
  for (const p of uniq) console.error('  ' + p);
  process.exit(1);
}
