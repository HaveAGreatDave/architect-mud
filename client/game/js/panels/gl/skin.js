// GLASS 2 · GPU SKINNING.
//
// A body built once in a bind pose follows its bones on the GPU: each vertex carries four bone
// indices and four weights (gl/ballplayer-mesh.js buildBody), and the vertex shader moves it by
// the weighted sum of its bones' skin transforms. New to GLASS: Rinkside rebuilds its skaters on
// the CPU every frame, which a ballplayer of 14,000 triangles can't afford twenty times over.
//
//   · the transforms live in a float texture, the PALETTE: a row a player, three RGBA texels a
//     bone, each texel a row of the bone's 3×4 transform (diamond/rig.js skinRows writes them);
//   · `SKIN_GLSL` is the vertex shader's half: `skinPos` and `skinDir` fetch a vertex's four bones
//     with texelFetch and blend them, linearly;
//   · `skinPoint` does the same sum on the CPU, so a gate can hold the shader's arithmetic to the
//     rig's without a GPU.
//
// The blend is linear. A twist of the forearm or the shoulder would collapse under it, which is
// why the plan offered dual quaternions; the bodies here don't need them, because each limb is its
// own tube that turns whole with its bone and only bends across its knee or elbow, and the hands
// are bones of their own. If a twist ever has to be skinned, it goes in here, behind this API.
//
// ⚠ A FOLDED BONE IS A ZERO MATRIX WITH A MOVE, not a missing one: the fists and the bat fold to a
// point inside the body while the hands are free (diamond/rig.js boneFrames), and their triangles
// fall to nothing and draw no pixel. Don't normalise a folded vertex's normal on the CPU.

import { BONES } from '../diamond/rig.js';

export const SKIN_TEXELS = 3;                          // texels a bone
export const PALETTE_W = BONES.length * SKIN_TEXELS;   // texels a row

// The vertex shader's half. Attributes 5 and 6 are the bone indices and weights (bytes, the
// weights normalised); `uBones` is the palette and `uBoneRow` this draw's player.
export const SKIN_GLSL = `
layout(location = 5) in vec4 aBones;
layout(location = 6) in vec4 aWeights;
uniform highp sampler2D uBones;
uniform int uBoneRow;
mat3x4 skinBone(float b) {
  int x = int(b + 0.5) * ${SKIN_TEXELS};
  return mat3x4(texelFetch(uBones, ivec2(x, uBoneRow), 0), texelFetch(uBones, ivec2(x + 1, uBoneRow), 0), texelFetch(uBones, ivec2(x + 2, uBoneRow), 0));
}
// a point: each bone's row-major 3×4 times (p, 1), weighted
vec3 skinPos(vec3 p) {
  vec4 h = vec4(p, 1.0); vec4 w = aWeights / max(dot(aWeights, vec4(1.0)), 1e-4);
  return (h * skinBone(aBones.x)) * w.x + (h * skinBone(aBones.y)) * w.y + (h * skinBone(aBones.z)) * w.z + (h * skinBone(aBones.w)) * w.w;
}
// a direction: the same without the move
vec3 skinDir(vec3 d) {
  vec4 h = vec4(d, 0.0); vec4 w = aWeights / max(dot(aWeights, vec4(1.0)), 1e-4);
  return (h * skinBone(aBones.x)) * w.x + (h * skinBone(aBones.y)) * w.y + (h * skinBone(aBones.z)) * w.z + (h * skinBone(aBones.w)) * w.w;
}
`;

// The CPU's copy of skinPos: `rows` is a player's palette row (diamond/rig.js skinRows), `bones`
// and `weights` a vertex's four each (weights in any scale), `p` a point, or a direction with w 0.
export function skinPoint(rows, bones, weights, p, w = 1) {
  const sum = weights[0] + weights[1] + weights[2] + weights[3] || 1;
  const out = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const wk = weights[k] / sum;
    if (!wk) continue;
    const o = bones[k] * 12;
    for (let i = 0; i < 3; i++) out[i] += wk * (rows[o + i * 4] * p[0] + rows[o + i * 4 + 1] * p[1] + rows[o + i * 4 + 2] * p[2] + rows[o + i * 4 + 3] * w);
  }
  return out;
}

// The palette: an RGBA32F texture, `rows` players high. `write(row, rows12)` copies a player's skin
// rows in (diamond/rig.js skinRows, 12 floats a bone); `upload()` sends what changed, once a frame;
// `bind(unit)` puts it on a texture unit. Returns null where float textures can't be made.
export function createBonePalette(gl, rows) {
  const data = new Float32Array(PALETTE_W * rows * 4);
  const dirty = new Set();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, PALETTE_W, rows);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(tex); return null; }
  // every row starts as the bind pose, so a body drawn before its pose arrives stands as built
  const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  for (let r = 0; r < rows; r++) for (let b = 0; b < BONES.length; b++) data.set(ident, (r * PALETTE_W + b * SKIN_TEXELS) * 4);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PALETTE_W, rows, gl.RGBA, gl.FLOAT, data);
  return {
    rows, tex,
    write(row, rows12) {
      if (row < 0 || row >= rows) return;
      data.set(rows12.subarray ? rows12.subarray(0, BONES.length * 12) : rows12.slice(0, BONES.length * 12), row * PALETTE_W * 4);
      dirty.add(row);
    },
    upload() {
      if (!dirty.size) return 0;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // the dirty rows as one band, which is one call however many players moved
      let lo = Infinity, hi = -1;
      for (const r of dirty) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, lo, PALETTE_W, hi - lo + 1, gl.RGBA, gl.FLOAT, data, lo * PALETTE_W * 4);
      const n = dirty.size;
      dirty.clear();
      return n;
    },
    bind(unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); },
    dispose() { gl.deleteTexture(tex); },
  };
}
