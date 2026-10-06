// THE SKY AS A CUBE, FOR REFLECTIONS (RENDER_TUNE.glEnvCube).
//
// A building's reflection was a two-colour gradient off the reflected ray: the dimmed horizon colour
// above, the shadow colour below, and the skyline strip mixed over it. Glass reflected the weather's
// average and nothing of the sky itself. This renders the sky the GPU sky pass draws (SKY_DIR_GLSL in
// gl/sky.js: the hour's gradient, the sun's glow, the airglow and the galaxy band) into a small cube,
// with the overcast ceiling over it and the ground colour below the horizon, and a chain of blurred
// levels under it. The city's shader samples it along the reflected ray at a level picked by the
// surface's roughness: chrome and curtain glass read the sharp top level, brick a soft one.
//
// ⚠ IT IS REBUILT WHEN THE SKY CHANGES, NOT EVERY FRAME. The key below is the inputs rounded to what
// can be seen, so a frame where the hour has not moved costs one string compare.
// ⚠ EIGHT BITS, ON PURPOSE. The sky is display values in 0..1, RGBA8 is renderable and filterable on
// every WebGL2 device, and generateMipmap needs both. A float cube would need EXT_color_buffer_float
// for nothing.
// ⚠ THE MIPS ARE A BOX FILTER, NOT A GGX PREFILTER. For a smooth gradient with one glow in it the
// difference doesn't show; a scene with sharp detail in the cube (the skyline, if it ever moves in
// here) would want a proper per-level blur, which hdr.js's blur pass could do.
import { SKY_DIR_GLSL } from './sky.js';

const SIZE = 32;
// The coarsest level the shader may ask for: 32, 16, 8, 4, 2, 1 is six levels, 0 to 5.
export const ENV_MAX_LOD = Math.log2(SIZE);

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// The face directions are the GLES 3.0 cube-map table read backwards (the major axis and the s/t
// signs per face), so a texel written here is the texel a lookup along the same world direction
// reads. World axes as everywhere in GLASS: z up.
const FRAG = `#version 300 es
precision highp float;
uniform int uFace;
uniform float uSize;
uniform float uOvercast;
uniform vec3 uCeil;
uniform vec3 uGround;
out vec4 outColor;
${SKY_DIR_GLSL}
vec3 faceDir(int f, vec2 st) {
  vec2 c = st * 2.0 - 1.0;
  if (f == 0) return vec3(1.0, -c.y, -c.x);
  if (f == 1) return vec3(-1.0, -c.y, c.x);
  if (f == 2) return vec3(c.x, 1.0, c.y);
  if (f == 3) return vec3(c.x, -1.0, -c.y);
  if (f == 4) return vec3(c.x, -c.y, 1.0);
  return vec3(-c.x, -c.y, -1.0);
}
void main() {
  vec3 dir = normalize(faceDir(uFace, gl_FragCoord.xy / uSize));
  float band;
  vec3 col = skyDirColor(dir, SUN_LOBE_CUBE, band);
  float e = dir.z;
  // The overcast: the 2-D sky's ceiling colour over the dome, thicker toward the horizon as the
  // wash and the deck are. The sun's glow was already scaled down by the caller.
  col = mix(col, uCeil, clamp(uOvercast, 0.0, 1.0) * mix(0.85, 0.6, clamp(e, 0.0, 1.0)));
  // Below the horizon a reflection sees the street, not more sky: the ground colour the old
  // gradient reflection used, eased in over a few degrees so the blurred levels carry the seam.
  col = mix(col, uGround, smoothstep(0.0, -0.08, e));
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('envcube shader: ' + log);
  }
  return sh;
}

const r = (v, q) => Math.round(v / q);
const keyOf = (s, ground) => [
  ...(s.top || []), ...(s.hor || []), ...(s.sunCol || []), ...(s.ceil || []).map((v) => Math.round(v)),
  ...(s.sunDir ? s.sunDir.map((v) => r(v, 0.01)) : ['-']), r(s.nightA || 0, 0.02), r(s.airglow || 0, 0.02),
  r(s.overcast || 0, 0.02), ...(ground || [0, 0, 0]).map((v) => r(v, 0.004)),
].join(',');

// One per GL context. update() returns the cube texture, or null if it could not be built, which the
// caller reads as "use the gradient".
export function createEnvCube(gl) {
  let prog = null, loc = null, tex = null, fbo = null, vao = null, key = '', broken = false;
  function build() {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('envcube link: ' + gl.getProgramInfoLog(prog));
    const u = (n) => gl.getUniformLocation(prog, n);
    loc = { face: u('uFace'), size: u('uSize'), overcast: u('uOvercast'), ceil: u('uCeil'), ground: u('uGround'),
      top: u('uTop'), hor: u('uHor'), sunDir: u('uSunDir'), sunCol: u('uSunCol'), sunOn: u('uSunOn'), nightA: u('uNightA'), airglow: u('uAirglow') };
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, ENV_MAX_LOD + 1, gl.RGBA8, SIZE, SIZE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
    fbo = gl.createFramebuffer();
    vao = gl.createVertexArray();
  }
  function update(sky, ground) {
    if (broken || !sky) return null;
    const k = keyOf(sky, ground);
    if (k === key && tex) return tex;
    try {
      if (!prog) build();
      // Saved and handed back, because this runs in the middle of a frame whose other passes don't
      // expect it. Only on a rebuild, so the queries cost nothing on a steady frame.
      const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), vp = gl.getParameter(gl.VIEWPORT);
      const caps = [gl.DEPTH_TEST, gl.BLEND, gl.CULL_FACE, gl.SCISSOR_TEST].map((c) => [c, gl.isEnabled(c)]);
      for (const [c] of caps) gl.disable(c);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, SIZE, SIZE);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      const u = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];
      const oc = Math.max(0, Math.min(1, sky.overcast || 0));
      gl.uniform1f(loc.size, SIZE);
      gl.uniform1f(loc.overcast, oc);
      gl.uniform3fv(loc.ceil, u(sky.ceil || [128, 132, 140]));
      gl.uniform3fv(loc.ground, ground || [0.13, 0.16, 0.21]);
      gl.uniform3fv(loc.top, u(sky.top)); gl.uniform3fv(loc.hor, u(sky.hor));
      gl.uniform3fv(loc.sunDir, sky.sunDir || [0, 0, 1]);
      gl.uniform3fv(loc.sunCol, u(sky.sunCol || [0, 0, 0]));
      // Cloud hides the sun's glow along with the sky behind it.
      gl.uniform1f(loc.sunOn, sky.sunDir ? 1 - oc : 0);
      gl.uniform1f(loc.nightA, sky.nightA || 0); gl.uniform1f(loc.airglow, sky.airglow || 0);
      for (let f = 0; f < 6; f++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, tex, 0);
        gl.uniform1i(loc.face, f);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X, null, 0);
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
      gl.viewport(vp[0], vp[1], vp[2], vp[3]);
      for (const [c, on] of caps) if (on) gl.enable(c);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
      key = k;
      return tex;
    } catch (e) {
      broken = true;
      console.warn('[glass2] the reflection cube could not be built; reflections use the gradient', e);
      return null;
    }
  }
  return { update };
}
