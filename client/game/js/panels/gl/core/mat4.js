// GL CORE · 4x4 MATRICES. The one copy of the matrix sums every renderer uses
// (docs/proposals/gl-core.md).
//
// Column-major, the layout WebGL takes: element (row r, column c) is m[c * 4 + r]. Plain arrays of
// doubles by default, so a gate can hold a result to the exact pinhole sums; WebGL rounds them to
// floats on upload.
//
// Every function takes an optional `out` and writes into it instead of making a new array, for the
// hot paths that build a matrix every frame. `out` may be one of the inputs: the sum is worked out
// first and copied in after.
//
// The arithmetic is written in the same order as the copies it replaced (gl/camera.js multiply,
// rink/camera.js mul, kitchen.js mat4mul, taa.js and cloudvol.js invert4, diamond/camera.js
// perspective and lookAt), so a caller moved onto it gets the same numbers to the last bit.
// scripts/shapes/core-mat4.mjs holds that.

const T = new Array(16);

function finish(out) {
  if (!out) return T.slice();
  for (let i = 0; i < 16; i++) out[i] = T[i];
  return out;
}

// a · b: b first, then a.
export function multiply(a, b, out) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      T[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return finish(out);
}

// The inverse, or null when the matrix has none (out is left alone then).
export function invert(m, out) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const d = 1 / det;
  T[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; T[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
  T[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; T[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
  T[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; T[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
  T[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; T[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
  T[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; T[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
  T[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; T[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
  T[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; T[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
  T[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; T[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
  return finish(out);
}

// A symmetric perspective: `fov` the vertical angle in radians, depth -1..1 from near to far.
export function perspective(fov, aspect, near, far, out) {
  const t = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  T[0] = t / aspect; T[1] = 0; T[2] = 0; T[3] = 0;
  T[4] = 0; T[5] = t; T[6] = 0; T[7] = 0;
  T[8] = 0; T[9] = 0; T[10] = (far + near) * nf; T[11] = -1;
  T[12] = 0; T[13] = 0; T[14] = 2 * far * near * nf; T[15] = 0;
  return finish(out);
}

// The view from `eye` toward `at`, with `up` as near to straight up on the screen as it can be.
// Looking along `up` itself has no answer; the result is then a matrix of zeros and NaNs, as the
// old copies gave.
export function lookAt(eye, at, up = UP_Y, out) {
  let fx = at[0] - eye[0], fy = at[1] - eye[1], fz = at[2] - eye[2];
  let l = Math.hypot(fx, fy, fz) || 1;
  fx /= l; fy /= l; fz /= l;
  let rx = fy * up[2] - fz * up[1], ry = fz * up[0] - fx * up[2], rz = fx * up[1] - fy * up[0];
  l = Math.hypot(rx, ry, rz) || 1;
  rx /= l; ry /= l; rz /= l;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const zx = -fx, zy = -fy, zz = -fz;
  T[0] = rx; T[1] = ux; T[2] = zx; T[3] = 0;
  T[4] = ry; T[5] = uy; T[6] = zy; T[7] = 0;
  T[8] = rz; T[9] = uz; T[10] = zz; T[11] = 0;
  T[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  T[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  T[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  T[15] = 1;
  return finish(out);
}

export const UP_Y = Object.freeze([0, 1, 0]);
export const UP_Z = Object.freeze([0, 0, 1]);
