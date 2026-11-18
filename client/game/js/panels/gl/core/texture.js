// GL CORE · TEXTURES (docs/proposals/gl-core.md, phase 1).
//
// One way to make a 2-D texture with its filter and wrap set, in place of the copy each renderer kept.
// `scripts/gl/core-lint.mjs` counts TEXTURE_MIN_FILTER outside this folder, so a new renderer uses this.
//
//   texture2D(gl, { w, h })                                     an RGBA8 colour target, linear, clamped
//   texture2D(gl, { w, h, depth: true })                        a 24-bit depth texture, nearest
//   texture2D(gl, { w: 1, h: 1, data: new Uint8Array([...]) })  a one-texel constant
//
// `filter` is the min and mag filter (LINEAR unless depth), `wrap` both wraps (CLAMP_TO_EDGE). Mipmaps
// aren't made here: a texture that wants them calls generateMipmap after its upload.
export function texture2D(gl, { w, h, depth = false, format = null, type = null, base = null, filter = null, wrap = null, data = null } = {}) {
  const fmt = format || (depth ? gl.DEPTH_COMPONENT24 : gl.RGBA8);
  const ty = type || (depth ? gl.UNSIGNED_INT : gl.UNSIGNED_BYTE);
  const bs = base || (depth ? gl.DEPTH_COMPONENT : gl.RGBA);
  const f = filter || (depth ? gl.NEAREST : gl.LINEAR), wr = wrap || gl.CLAMP_TO_EDGE;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, bs, ty, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
  return t;
}
