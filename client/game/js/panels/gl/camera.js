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

// ── WHERE THE EYE IS, IN THE FRAME THE VERTICES ARE IN ──────────────────────
//
// Every view-dependent term — a specular lobe, a fresnel edge, a reflected ray — is a function of
// the direction from a surface to the eye, and until this existed the fragment shader had no way to
// ask. It is not a new camera: it is `viewMatrix`'s own translation, solved for the point that lands
// at the origin of camera space.
//
//   l = (dx + tx)·cosh + (dy + ty)·sinh        tx =  back·sinh − fx
//   f = (dx + tx)·sinh − (dy + ty)·cosh        ty = −back·cosh − fy
//   u = wz − EH
//
// l = f = u = 0 has exactly one solution, and the rotation is orthonormal so it falls out without
// inverting anything: dx = −tx, dy = −ty, wz = EH.
//
// ⚠ PITCH DOES NOT MOVE IT. `viewMatrix` applies pitch as a rotation of the (forward, up) plane
// ABOUT the eye, so the origin of camera space is the same point tilted or level — which is why
// there is no pitch term here and why a pitched camera must not get its own derivation.
//
// ⚠ AND IT IS IN THE CALLER'S FRAME, WHATEVER THAT IS. `cam.fx`/`fy` are the "subtract this from
// the world position" terms, so handing this the SHIFTED camera (`camAt` in world.js, which folds
// `ox`/`oy` in) returns the eye in map-window tiles — the frame the mesh and the lights are already
// in. Handing it the plain one returns world tiles. Mixing the two slides every highlight in the
// city by the window offset, which reads as the sun being in the wrong place.
export function eyePos(cam) {
  const { sinh, cosh, back = 0, fx = 0, fy = 0, EH } = cam;
  return [fx - back * sinh, fy + back * cosh, EH];
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

// ── THE SUN, AS A MATRIX ────────────────────────────────────────────────────
//
// A shadow map is a second render of the same city from where the light is, so it needs the same
// thing the camera needed: the projection GLASS already implies, written as a 4x4 rather than
// approximated by one. GLASS's sun is two numbers — `dir`, the direction toward it in tile space,
// and `len`, how far a shadow reaches per unit of height. `drawBuildingShadow` has always used them
// the same way: a point at height z lands its shadow `len * z` along `-dir`.
//
// ⚠ SO THE LIGHT DIRECTION IS DERIVED FROM THAT RELATION, NOT FROM AN ELEVATION ANGLE. `sun.elev`
// exists and is NOT the same quantity — it is `sin(dayT * PI)`, a brightness curve, while `len` is
// clamped to 0.5..3.4 so a low sun does not throw a shadow across the whole map. If this file took
// the elevation instead, a building's shadow on its neighbour would point somewhere its shadow on
// the ground does not, and nothing in the picture would say which of the two was wrong.
//
// `bounds` is the mesh's own axis-aligned box, in the same frame the vertices are in. It comes from
// the buffer rather than from the window, so a caster can never be outside the box that is supposed
// to contain every caster.
export function lightMatrix(sun, b) {
  const len = Math.max(0.05, sun.len || 1);
  // Travel: from the sun toward the ground. `(-dir * len, -1)` before normalising, which is exactly
  // the vector `drawBuildingShadow` walks when it offsets a roof corner onto the ground.
  let lx = -sun.dir[0] * len, ly = -sun.dir[1] * len, lz = -1;
  const ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
  // ⚠ THE UP REFERENCE HAS TO DODGE THE LIGHT, AND AT NOON IT NEARLY DOES NOT. A high sun makes
  // the travel vector almost world -z, so crossing it with world +z gives a zero-length vector and
  // every term below comes out NaN. A NaN matrix draws an empty shadow map, which is indistinguishable
  // from a sunny day on which nothing happens to cast — no error, no warning, no shadows.
  const steep = Math.abs(lz) > 0.99;
  const ref = steep ? [0, 1, 0] : [0, 0, 1];
  // right = normalize(ref x L), up = L x right. Right-handed, and the handedness does not matter:
  // the map is only ever compared against itself.
  let rx = ref[1] * lz - ref[2] * ly, ry = ref[2] * lx - ref[0] * lz, rz = ref[0] * ly - ref[1] * lx;
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  const ux = ly * rz - lz * ry, uy = lz * rx - lx * rz, uz = lx * ry - ly * rx;

  // The eight corners of the mesh box, in light space, give the tightest ortho box that still holds
  // every caster. Tight matters: the map is a fixed number of texels, so every tile of slack is
  // resolution spent on empty ground.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const px = (i & 1) ? b.x1 : b.x0, py = (i & 2) ? b.y1 : b.y0, pz = (i & 4) ? b.z1 : b.z0;
    const cx = px * rx + py * ry + pz * rz;
    const cy = px * ux + py * uy + pz * uz;
    const cz = px * lx + py * ly + pz * lz;
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
    if (cz < z0) z0 = cz; if (cz > z1) z1 = cz;
  }
  // A degenerate axis (one building, one tile, a flat plate) would divide by zero.
  const sx = 2 / Math.max(1e-4, x1 - x0), sy = 2 / Math.max(1e-4, y1 - y0), sz = 2 / Math.max(1e-4, z1 - z0);
  const tx = -(x1 + x0) / Math.max(1e-4, x1 - x0);
  const ty = -(y1 + y0) / Math.max(1e-4, y1 - y0);
  const tz = -(z1 + z0) / Math.max(1e-4, z1 - z0);
  // Column-major, same layout as everything else here: world -> light clip, w fixed at 1.
  return [
    rx * sx, ux * sy, lx * sz, 0,
    ry * sx, uy * sy, ly * sz, 0,
    rz * sx, uz * sy, lz * sz, 0,
    tx, ty, tz, 1,
  ];
}
