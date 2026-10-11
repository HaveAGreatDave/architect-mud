// THE LENS AND THE PICTURE: how a resolved frame becomes a broadcast.
//
// A renderer that grades its own frame (gl/ballpark.js) hands over what hdr.js resolved, the
// bloom it gathered, a depth texture and the occlusion, and this draws the last two passes:
//
//   1. the lens and the curve, into an eight-bit target: depth of field gathered from the depth
//      and the shot's focus, the occlusion, the bloom, the exposure and ACES in linear light,
//      the encode, and the grade;
//   2. the screen, onto the canvas: sharpening and the vignette, the period's video for the
//      broadcast preset, and the tube glass if it's on.
//
// Three grades (docs/proposals/deadball-glass2.md, The look):
//
//   arcade     the default: full saturation, deep blacks, a contrast curve with warm highlights
//              over cool shadows, light sharpening and a soft vignette;
//   broadcast  the period's television: lifted blacks, colour softer than the picture, the
//              camera's aperture correction, a little lateral colour and the CCD's vertical smear
//              off the lamps;
//   none       the curve and nothing else.
//
// The tube glass is a separate switch: scanlines, an aperture grille, a gently curved tube and
// rounded corners. The graphics have to move inside a title-safe area when it's on.
//
// ⚠ EVERY EXIT RETURNS null, as hdr.js's do: no eight-bit target, no program, no pass, and the
// caller draws its plain curve instead.

import { declareProgram, takeWarm } from './programs.js';

const FULL_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

export const GRADES = Object.freeze({ none: 0, arcade: 2, broadcast: 1 });

// The circle of confusion for a pixel at depth z, in pixels: how far out of focus it is for a lens
// focused at `focus` with strength `k` (the shot's `dof`), capped at the gather's reach. The JS
// twin of the shader's, for the gate.
export const DOF_MAX = 14;
export function cocOf(z, focus, k) { return Math.min(DOF_MAX, Math.abs(1 / focus - 1 / z) * k); }

const LENS_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uScene; uniform sampler2D uB0; uniform sampler2D uB1; uniform sampler2D uDepth; uniform sampler2D uAO;
uniform float uBloom; uniform float uExp; uniform int uGrade; uniform float uAOK;
uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uDof; uniform int uTaps; uniform vec2 uTx;
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
float coc(vec2 t) { return clamp(abs(1.0 / uFocus - 1.0 / lin(texture(uDepth, t).r)) * uDof, 0.0, ${DOF_MAX.toFixed(1)}); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 oetf(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 c = texture(uScene, vUV).rgb;
  // the lens: a golden-angle gather, each tap weighted by whether it's blurred as far as it reaches,
  // so a sharp subject doesn't bleed onto the soft crowd behind it
  if (uDof > 0.0 && uTaps > 0) {
    float r0 = coc(vUV);
    if (r0 > 0.6) {
      vec3 acc = c; float wsum = 1.0;
      for (int i = 0; i < 28; i++) {
        if (i >= uTaps) break;
        float fi = float(i), a = fi * 2.39996, rr = sqrt((fi + 0.5) / float(uTaps)) * r0;
        vec2 t = vUV + vec2(cos(a), sin(a)) * rr * uTx;
        float w = smoothstep(rr - 1.0, rr + 0.5, coc(t));
        acc += texture(uScene, t).rgb * w; wsum += w;
      }
      c = acc / wsum;
    }
  }
  // the occlusion, faded out with distance so it never greys the far stands; an aoK past 1.5 is
  // the bench's view of the term alone
  if (uAOK > 1.5) { o = vec4(vec3(texture(uAO, vUV).r), 1.0); return; }
  c *= mix(1.0, texture(uAO, vUV).r, uAOK * (1.0 - smoothstep(900.0, 1500.0, lin(texture(uDepth, vUV).r))));
  c += (texture(uB0, vUV).rgb + texture(uB1, vUV).rgb) * uBloom;
  vec3 s = oetf(aces(max(c, 0.0) * uExp));
  if (uGrade == 2) {
    // the arcade board: saturation, a contrast curve, warm highlights over cool shadows
    float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
    s = mix(vec3(l), s, 1.16);
    s = mix(s, s * s * (3.0 - 2.0 * s), 0.28);
    s *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.95), smoothstep(0.2, 0.8, l));
  } else if (uGrade == 1) {
    // broadcast video: lifted blacks, a little warmth, the colour held back
    s = s * 0.97 + 0.012;
    float l = dot(s, vec3(0.299, 0.587, 0.114));
    s = mix(vec3(l), s, 0.93) * vec3(1.015, 1.0, 0.975);
  }
  o = vec4(clamp(s, 0.0, 1.0), 1.0);
}`;

const SCREEN_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uLdr; uniform sampler2D uSmear; uniform vec2 uTx; uniform int uGrade; uniform int uTube; uniform float uSeed;
const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
void main() {
  vec2 st = vUV;
  // the tube bulges a little toward the viewer
  if (uTube == 1) { vec2 d = vUV - 0.5; st = 0.5 + d * (1.0 + dot(d, d) * 0.05); }
  vec3 c = texture(uLdr, st).rgb;
  vec2 d = st - 0.5; float r2 = dot(d, d);
  if (uGrade == 2) {
    // light sharpening on luma, and the vignette
    float yb = dot(texture(uLdr, st + vec2(uTx.x, 0.0)).rgb + texture(uLdr, st - vec2(uTx.x, 0.0)).rgb
      + texture(uLdr, st + vec2(0.0, uTx.y)).rgb + texture(uLdr, st - vec2(0.0, uTx.y)).rgb, vec3(0.25 / 3.0));
    c += (dot(c, vec3(1.0 / 3.0)) - yb) * 0.35;
    c *= 1.0 - r2 * 0.22;
  } else if (uGrade == 1) {
    // lateral colour at the edges
    vec2 ca = d * r2 * 0.006;
    c = vec3(texture(uLdr, st + ca).r, c.g, texture(uLdr, st - ca).b);
    vec3 yiq = toYIQ * c;
    // the period's aperture correction on luma
    float yb = (toYIQ * texture(uLdr, st + vec2(uTx.x, 0.0)).rgb).x + (toYIQ * texture(uLdr, st - vec2(uTx.x, 0.0)).rgb).x
      + (toYIQ * texture(uLdr, st + vec2(0.0, uTx.y)).rgb).x + (toYIQ * texture(uLdr, st - vec2(0.0, uTx.y)).rgb).x;
    yiq.x += (yiq.x - yb * 0.25) * 0.55;
    // composite video: the colour is softer than the picture
    vec2 iq = vec2(0.0); float w = 0.0;
    for (int i = -3; i <= 3; i++) { float k = exp(-float(i * i) / 5.0); iq += (toYIQ * texture(uLdr, st + vec2(float(i) * uTx.x * 1.6, 0.0)).rgb).yz * k; w += k; }
    yiq.yz = iq / w;
    c = toRGB * yiq;
    // the CCD smeared a bright lamp into a vertical streak; only a lamp, not a lit chalk line
    vec3 sm = vec3(0.0);
    for (int i = -20; i <= 20; i++) sm += max(texture(uSmear, vec2(st.x, st.y + float(i) * 0.012)).rgb - 0.5, 0.0) * exp(-abs(float(i)) * 0.11);
    c += sm * 0.02 * vec3(0.9, 0.95, 1.0);
    c += (fract(sin(dot(st * 1000.0 + uSeed, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.012;
    c *= 1.0 - r2 * 0.32;
  }
  if (uTube == 1) {
    // scanlines, the aperture grille, and the glass rounding off the corners
    float line = 0.5 + 0.5 * cos(st.y / uTx.y * 3.14159 / 1.5);
    c *= mix(1.0, 0.72 + 0.28 * line, 0.75);
    float m = mod(gl_FragCoord.x, 3.0);
    c *= (m < 1.0 ? vec3(1.0, 0.82, 0.82) : m < 2.0 ? vec3(0.82, 1.0, 0.82) : vec3(0.82, 0.82, 1.0)) * 1.12;
    vec2 q = abs(st - 0.5) * 2.0;
    c *= smoothstep(1.0, 0.985, max(q.x, q.y)) * (1.0 - smoothstep(0.06, 0.1, length(max(q - 0.9, 0.0))));
    c += vec3(0.05, 0.06, 0.08) * smoothstep(0.25, 0.0, length(vUV - vec2(0.28, 0.22)));
  }
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

declareProgram(FULL_VS, LENS_FS);
declareProgram(FULL_VS, SCREEN_FS);

export function createBroadcastPass(gl) {
  const link = (fs) => {
    let p = takeWarm(gl, FULL_VS, fs);
    if (!p) {
      p = gl.createProgram();
      for (const [t, src] of [[gl.VERTEX_SHADER, FULL_VS], [gl.FRAGMENT_SHADER, fs]]) {
        const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
        gl.attachShader(p, sh); gl.deleteShader(sh);
      }
      gl.linkProgram(p);
    }
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    const u = {};
    return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) };
  };
  const LENS = link(LENS_FS), SCREEN = link(SCREEN_FS);
  if (!LENS || !SCREEN) return null;
  const emptyVao = gl.createVertexArray();
  // a white texel, for a frame with no occlusion or no bloom
  const white = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  const black = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, black);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  let W = 0, H = 0, ldr = null;
  function resize(w, h) {
    if (w === W && h === H && ldr) return true;
    if (ldr) { gl.deleteFramebuffer(ldr.fbo); gl.deleteTexture(ldr.tex); ldr = null; }
    W = w; H = h;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); W = H = 0; return false; }
    ldr = { tex, fbo };
    return true;
  }
  // f: { scene, bloom: [t0, t1] | null, depth | null, ao | null, w, h, near, far, focus, dof, taps,
  //      exposure, bloomK, aoK, grade: 'arcade' | 'broadcast' | 'none', tube, seed }
  function render(f) {
    if (!resize(f.w, f.h)) return false;
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(emptyVao);
    const tex = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
    // 1. the lens and the curve
    gl.bindFramebuffer(gl.FRAMEBUFFER, ldr.fbo); gl.viewport(0, 0, W, H);
    gl.useProgram(LENS.p);
    tex(0, f.scene); tex(1, f.bloom ? f.bloom[0] : black); tex(2, f.bloom ? f.bloom[1] : black);
    tex(3, f.depth || white); tex(4, f.ao || white);
    for (const [n, i] of [['uScene', 0], ['uB0', 1], ['uB1', 2], ['uDepth', 3], ['uAO', 4]]) gl.uniform1i(LENS.u(n), i);
    gl.uniform1f(LENS.u('uBloom'), f.bloom ? f.bloomK : 0); gl.uniform1f(LENS.u('uExp'), f.exposure);
    gl.uniform1i(LENS.u('uGrade'), GRADES[f.grade] ?? 2); gl.uniform1f(LENS.u('uAOK'), f.ao && f.depth ? f.aoK : 0);
    gl.uniform1f(LENS.u('uNear'), f.near); gl.uniform1f(LENS.u('uFar'), f.far);
    gl.uniform1f(LENS.u('uFocus'), f.focus || 1); gl.uniform1f(LENS.u('uDof'), f.depth ? f.dof || 0 : 0);
    gl.uniform1i(LENS.u('uTaps'), f.taps | 0); gl.uniform2f(LENS.u('uTx'), 1 / W, 1 / H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 2. the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    gl.useProgram(SCREEN.p);
    tex(0, ldr.tex); tex(1, f.bloom ? f.bloom[0] : black);
    gl.uniform1i(SCREEN.u('uLdr'), 0); gl.uniform1i(SCREEN.u('uSmear'), 1);
    gl.uniform2f(SCREEN.u('uTx'), 1 / W, 1 / H); gl.uniform1i(SCREEN.u('uGrade'), GRADES[f.grade] ?? 2);
    gl.uniform1i(SCREEN.u('uTube'), f.tube ? 1 : 0); gl.uniform1f(SCREEN.u('uSeed'), f.seed || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    return true;
  }
  function dispose() {
    if (ldr) { gl.deleteFramebuffer(ldr.fbo); gl.deleteTexture(ldr.tex); ldr = null; }
    gl.deleteTexture(white); gl.deleteTexture(black);
  }
  return { render, dispose };
}
