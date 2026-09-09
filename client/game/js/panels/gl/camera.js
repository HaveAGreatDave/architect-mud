// THE SAME CAMERA, AS A MATRIX.
//
// GLASS projects by hand, one point at a time: `sx = cx + FL·(l/f)`, `sy = horizonY − depth·(u/f)`.
// That is not an approximation of a perspective camera, it IS one — a pinhole with two focal
// lengths (FL across, `depth` up) and a principal point at `(W/2, horizonY)` that sits well above
// centre because the horizon does. So a GL renderer does not need a new camera, a matched camera or
// a camera tuned until it looks close. It needs the same one, written as a 4×4.
//
// ⚠ THAT EQUIVALENCE IS THE WHOLE SPIKE. A second renderer drawing the same city through a slightly
// different camera would look like an improvement and be a regression — every building an inch from
// where the collision, the shadows and the occlusion field all say it is. So this file is written to
// be CHECKED rather than trusted: scripts/shapes/glparity.mjs projects the same points through
// `cam.proj` and through this matrix and fails on a disagreement above a hundredth of a pixel,
// across headings, eye heights, chase offsets and pitches.
//
// Nothing here touches WebGL. It is arithmetic, so it runs in node, which is what makes the gate
// possible at all — there is no GL context in a smoke test.

// Camera space is the one GLASS already works in: +x is lateral (`l`), +y is up (`wz − EH`),
// +z is forward (`f`). Right-handed with z INTO the screen, which is not GL's convention and does
// not need to be: the projection matrix below is written for this space and nothing else consumes
// it.
export function viewMatrix(cam) {
  const { sinh, cosh, back, fx = 0, fy = 0, EH, pitch = 0 } = cam;
  // World → camera, exactly as `proj` does it:
  //   bx = dx + back·sinh − fx      by = dy − back·cosh − fy
  //   f  = bx·sinh − by·cosh        l  = bx·cosh + by·sinh        u = wz − EH
  // As a matrix that is a translation by (back·sinh − fx, −back·cosh − fy, −EH) followed by the
  // heading rotation. Written out rather than composed from helpers so the terms can be read
  // against `proj` line for line.
  const tx = back * sinh - fx, ty = -back * cosh - fy;
  // l = (dx + tx)·cosh + (dy + ty)·sinh
  // f = (dx + tx)·sinh − (dy + ty)·cosh
  // u = wz − EH
  const m = [
    cosh, 0, sinh, 0,
    sinh, 0, -cosh, 0,
    0, 1, 0, 0,
    tx * cosh + ty * sinh, -EH, tx * sinh - ty * cosh, 1,
  ];
  if (!pitch) return m;
  // Pitch rotates the (forward, up) plane about the lateral axis, positive tipping the view down:
  //   f' = f·cos − u·sin        u' = u·cos + f·sin
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    const l = m[c * 4], u = m[c * 4 + 1], f = m[c * 4 + 2], w = m[c * 4 + 3];
    out[c * 4] = l;
    out[c * 4 + 1] = u * cp + f * sp;
    out[c * 4 + 2] = f * cp - u * sp;
    out[c * 4 + 3] = w;
  }
  return out;
}

// The projection, in the same column-major layout, mapping camera space to clip space.
//
//   x_ndc = (2·FL/W)·(l/f)
//   y_ndc = (1 − 2·horizonY/H) + (2·depth/H)·(u/f)
//   w     = f
//
// The y row carries a term in `f` — that is the principal point being off centre, and it is why a
// stock `perspective()` helper cannot be used here: the horizon is not in the middle of the canvas.
// THE CLIP RANGE, NAMED ONCE. It decides how depth-buffer precision is distributed, so anything
// reasoning about whether two coplanar surfaces can be told apart needs the same two numbers the
// matrix was built with — and a second copy of them is a second thing to forget to change.
export const NEAR = 0.06, FAR = 400;

export function projMatrix(cam, H, near = NEAR, far = FAR) {
  const fxn = 2 * cam.FL / cam.W;
  const fyn = 2 * cam.depth / H;
  const cy0 = 1 - 2 * cam.horizonY / H;
  // Standard z mapping so the depth buffer has something to test; the picture does not depend on it.
  const A = (far + near) / (far - near), B = -2 * far * near / (far - near);
  return [
    fxn, 0, 0, 0,
    0, fyn, 0, 0,
    0, cy0, A, 1,
    0, 0, B, 0,
  ];
}

export function multiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

// The whole transform, world → clip.
export function viewProjMatrix(cam, H, near, far) {
  return multiply(projMatrix(cam, H, near, far), viewMatrix(cam));
}

// What a vertex shader would do, in JS, so a test can compare it with `cam.proj` without a GPU.
// Returns screen pixels and the same `f` the painter's queue sorts on.
export function projectThrough(m, x, y, z, W, H) {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  const f = cw;
  const ndcX = cx / cw, ndcY = cy / cw;
  return { sx: (ndcX + 1) * 0.5 * W, sy: (1 - ndcY) * 0.5 * H, f };
}
