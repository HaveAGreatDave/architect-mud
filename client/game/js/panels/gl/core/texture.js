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

// Whether what's drawn into `fb` (a framebuffer, or null for the canvas) is float. A copy of its picture taken by blit
// has to be float too: WebGL2 refuses a blit between float and fixed-point colour, and a multisampled source wants the
// same format exactly. GLASS draws into an RGBA16F target where it can (gl/hdr.js); the Room Stage's canvas is 8-bit.
// Asked once per framebuffer object.
const FLOAT_FB = new WeakMap();
export function drawsFloat(gl, fb) {
  if (!fb) return false;
  let f = FLOAT_FB.get(fb);
  if (f === undefined) {
    const was = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    f = gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE) === gl.FLOAT;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, was);
    FLOAT_FB.set(fb, f);
  }
  return f;
}
