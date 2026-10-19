// TEMPORAL ANTI-ALIASING (RENDER_TUNE.glTaa). See docs/proposals/glass-lights-and-taa.md, stage B.
//
// MSAA covers geometry edges. What it can't touch is aliasing inside a surface: thin mullions,
// distant window grids, a highlight a pixel wide, all of which shimmer as the camera crawls. This
// spreads the samples over time instead: each frame is drawn a sub-pixel off (JITTER in camera.js,
// eight Halton(2,3) offsets), and a resolve blends it into a history that is reprojected to where
// each pixel was last frame.
//
// ⚠ SIGNS NEVER GO THROUGH IT. FXAA is off because it smeared the lettering on "CASH & CARRION",
// and a temporal blend smears worse and lags a flicker. So world.js splits the pass: the city, the
// ground, the water and the people go through, and then the sprites, the Curtain, the decals and
// lettering, the strokes, the billboards and the cabin are drawn unjittered over the result, never
// entering the history (the split is `split` in hdr.js).
//
// ⚠ ONE MATRIX DOES THE REPROJECTION. A fragment's NDC and depth are this frame's; the matrix takes
// them, unjittered, back through this frame's inverse view-projection into the window frame, shifts
// by how far the map window recentred (the window frame jumps a tile when it does), and on through
// last frame's view-projection. So the shader knows nothing about frames, and the CPU half is pure
// arithmetic the gate (scripts/shapes/gltaa.mjs) checks against projecting the point directly.
//
// ⚠ NO MOTION VECTORS. A thing moving on its own (a person, a car, your own vehicle) reprojects as if
// it were part of the city, and the neighbourhood clamp is what keeps it from trailing: last frame's
// colour is held inside the range this frame's 3x3 neighbourhood spans. Motion also raises the blend
// weight, so a fast pan leans on the current frame.
import { takeWarm, compileShader, declareProgram } from './programs.js';
import { multiply } from './camera.js';

export const TAA_TUNE = {
  alpha: 0.1,         // the current frame's share when still
  motionAlpha: 0.4,   // ...and when a pixel has moved `motionPx` or more
  motionPx: 8,
  clip: 1.0,          // neighbourhood range in standard deviations
  samples: 8,         // Halton sequence length
  // A gap longer than this (a backgrounded tab, a seat change) throws the history away.
  maxGapMs: 250,
  // ...and so does the map window recentring further than this, in tiles: that's a teleport.
  maxShift: 3,
  // 1 paints which path each pixel took instead of the picture: red reset, magenta behind the
  // camera, blue reprojected off screen, green history used (with red rising by motion, 4 px full).
  // 2 paints the depth the resolve reads, as z^64 (near is black, the far plane white); 3 writes
  // (motion px / 16, depth, vertical motion + 0.5) for a bench to read off the GL canvas.
  debug: 0,
};

export function halton(i, b) {
  let f = 1, r = 0;
  for (let n = i; n > 0; n = Math.floor(n / b)) { f /= b; r += f * (n % b); }
  return r;
}

// This frame's jitter, in NDC, for a drawing buffer w x h device pixels.
export function jitterFor(frame, w, h) {
  const k = (frame % TAA_TUNE.samples) + 1;
  return { x: (2 * (halton(k, 2) - 0.5)) / Math.max(1, w), y: (2 * (halton(k, 3) - 0.5)) / Math.max(1, h) };
}

// The inverse of a column-major 4x4, or null if it has none.
export function invert4(m) {
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

// This frame's NDC (unjittered) to last frame's clip: prevVP · T(shift) · inverse(curVP). `shift` is
// how far the map window's centre moved since last frame, this minus last, in tiles: a point at
// window position p this frame was at p + shift in last frame's window.
export function reprojMatrix(prevVP, curVP, shift = [0, 0]) {
  const inv = invert4(curVP);
  if (!inv) return null;
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, shift[0], shift[1], 0, 1];
  return multiply(prevVP, multiply(T, inv));
}

const FULL_VERT = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const TAA_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uCur;          // this frame, resolved, jittered, premultiplied
uniform sampler2D uHist;         // last frame's output
uniform highp sampler2D uDepth;  // this frame's depth, resolved
uniform mat4  uReproj;           // this frame's NDC (unjittered) to last frame's clip
uniform vec2  uJit;              // this frame's jitter, NDC
uniform vec2  uTexel;
uniform float uAlpha;
uniform float uMotionAlpha;
uniform float uMotionPx;
uniform float uClip;
uniform float uReset;
uniform float uDebug;
out vec4 outColor;
vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
// ⚠ RESOLVED IN A COMPRESSED SPACE, NOT IN RAW HDR. A lit window is several times brighter than
// white in the float target, and blended and clamped as it is one bright sample owns the result, so
// the window grids went on flickering under TAA (most of the shimmer left in a crawl, 2026-10-18).
// c / (1 + max(c)) going in and its inverse coming out keeps every sample's vote about the same size.
vec4 tmIn(vec4 c) { return vec4(c.rgb / (1.0 + max(c.r, max(c.g, c.b))), c.a); }
vec4 tmOut(vec4 c) { return vec4(c.rgb / max(1e-4, 1.0 - max(c.r, max(c.g, c.b))), c.a); }
// Catmull-Rom in five bilinear taps (Jimenez): the history is resampled at a fraction of a pixel
// every frame, and plain bilinear would blur it a little more each time.
vec4 history(vec2 uv) {
  vec2 res = 1.0 / uTexel;
  vec2 pos = uv * res;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (c - 1.0) * uTexel, t3 = (c + 2.0) * uTexel, t12 = (c + w2 / w12) * uTexel;
  float a = w12.x * w0.y, b = w0.x * w12.y, m = w12.x * w12.y, d = w3.x * w12.y, e = w12.x * w3.y;
  vec4 s = texture(uHist, vec2(t12.x, t0.y)) * a + texture(uHist, vec2(t0.x, t12.y)) * b
         + texture(uHist, t12) * m + texture(uHist, vec2(t3.x, t12.y)) * d + texture(uHist, vec2(t12.x, t3.y)) * e;
  return max(s / (a + b + m + d + e), vec4(0.0));
}
void main() {
  vec4 curRaw = texture(uCur, vUV);
  vec4 cur = tmIn(curRaw);
  if (uReset > 0.5) { outColor = uDebug > 0.5 ? vec4(1.0, 0.0, 0.0, 1.0) : curRaw; return; }
  // The 3x3 neighbourhood's mean and spread, in YCoCg with alpha as a fourth axis (the sky is
  // transparent, so an edge against it is an alpha edge too).
  vec4 m1 = vec4(0.0), m2 = vec4(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec4 s = tmIn(texture(uCur, vUV + vec2(float(x), float(y)) * uTexel));
    vec4 q = vec4(toYCoCg(s.rgb), s.a);
    m1 += q; m2 += q * q;
  }
  m1 /= 9.0; m2 /= 9.0;
  vec4 sig = sqrt(max(vec4(0.0), m2 - m1 * m1)) * uClip;
  float z = texture(uDepth, vUV).r;
  if (uDebug > 1.5 && uDebug < 2.5) { outColor = vec4(vec3(pow(z, 64.0)), 1.0); return; }
  // ⚠ THE PIXEL'S OWN POSITION, NOT ITS JITTERED ONE. The history stands for the unjittered picture
  // and only the current sample carries the jitter, which is the point of it. Subtracting the jitter
  // here sampled the history half a pixel off in a different direction every frame, so a still
  // camera's picture wandered with the Halton sequence: 9.4% of a still frame changed each frame
  // with the history at 98% (2026-10-18). uJit is still uploaded for a velocity term that would want it.
  vec4 pc = uReproj * vec4(vUV * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  if (pc.w <= 0.0) { outColor = uDebug > 0.5 ? vec4(1.0, 0.0, 1.0, 1.0) : curRaw; return; }
  vec2 puv = (pc.xy / pc.w) * 0.5 + 0.5;
  if (puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) { outColor = uDebug > 0.5 ? vec4(0.0, 0.0, 1.0, 1.0) : curRaw; return; }
  vec4 h = tmIn(history(puv));
  vec4 hq = clamp(vec4(toYCoCg(h.rgb), h.a), m1 - sig, m1 + sig);
  h = vec4(fromYCoCg(hq.xyz), clamp(hq.w, 0.0, 1.0));
  float moved = length((puv - vUV) / uTexel);
  float k = mix(uAlpha, uMotionAlpha, clamp(moved / max(0.001, uMotionPx), 0.0, 1.0));
  outColor = tmOut(mix(h, cur, k));
  if (uDebug > 0.5) outColor = vec4(clamp(moved / 4.0, 0.0, 1.0), 1.0, 0.0, 1.0);
  if (uDebug > 2.5) outColor = vec4(clamp(moved / 16.0, 0.0, 1.0), clamp(z, 0.0, 1.0), puv.y - vUV.y + 0.5, 1.0);
}`;

function link(gl) {
  const warm = takeWarm(gl, FULL_VERT, TAA_FRAG);
  if (warm) return gl.getProgramParameter(warm, gl.LINK_STATUS) ? warm : null;
  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, FULL_VERT, 'taa vertex'));
    gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, TAA_FRAG, 'taa fragment'));
    gl.linkProgram(prog);
    return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
  } catch { return null; }
}

// The resolve and its two history buffers, for one context. `makeTarget(w, h)` is hdr.js's own
// RGBA16F target maker, so the history is the same format as the scene. null if it won't link.
export function createTAA(gl, makeTarget) {
  const prog = link(gl);
  if (!prog) return null;
  const U = (n) => gl.getUniformLocation(prog, n);
  const u = {
    cur: U('uCur'), hist: U('uHist'), depth: U('uDepth'), reproj: U('uReproj'), jit: U('uJit'), texel: U('uTexel'),
    alpha: U('uAlpha'), motionAlpha: U('uMotionAlpha'), motionPx: U('uMotionPx'), clip: U('uClip'), reset: U('uReset'), debug: U('uDebug'),
  };
  const vao = gl.createVertexArray();
  let hist = [null, null], W = 0, H = 0, i = 0, primed = false;
  const M = new Float32Array(16);
  function free() {
    for (const t of hist) if (t) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); }
    hist = [null, null]; W = H = 0; primed = false;
  }
  // Resolves `curTex` against the history into the other history buffer and returns it.
  // `o` is { reproj (16 numbers, or null), jit: { x, y }, reset }.
  function run(curTex, depthTex, w, h, o) {
    if (w !== W || h !== H || !hist[0]) {
      free();
      hist = [makeTarget(w, h), makeTarget(w, h)];
      if (!hist[0] || !hist[1]) { free(); return null; }
      W = w; H = h;
    }
    const prev = hist[i], next = hist[1 - i];
    i = 1 - i;
    const reset = !primed || !!o.reset || !o.reproj;
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, curTex); gl.uniform1i(u.cur, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex); gl.uniform1i(u.hist, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, depthTex); gl.uniform1i(u.depth, 2);
    if (o.reproj) { M.set(o.reproj); gl.uniformMatrix4fv(u.reproj, false, M); }
    gl.uniform2f(u.jit, o.jit ? o.jit.x : 0, o.jit ? o.jit.y : 0);
    gl.uniform2f(u.texel, 1 / w, 1 / h);
    gl.uniform1f(u.alpha, TAA_TUNE.alpha);
    gl.uniform1f(u.motionAlpha, TAA_TUNE.motionAlpha);
    gl.uniform1f(u.motionPx, TAA_TUNE.motionPx);
    gl.uniform1f(u.clip, TAA_TUNE.clip);
    gl.uniform1f(u.reset, reset ? 1 : 0);
    gl.uniform1f(u.debug, TAA_TUNE.debug > 0 ? TAA_TUNE.debug : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Debug 3: read the probe points (TAA_TUNE.probe, device px from the bottom left) back as floats.
    if (TAA_TUNE.debug === 3 && TAA_TUNE.probe) {
      const f = new Float32Array(4);
      TAA_TUNE.probed = TAA_TUNE.probe.map(([x, y]) => { gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, f); return Array.from(f); });
    }
    for (const k of [2, 1, 0]) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.bindVertexArray(null);
    primed = true;
    return next;
  }
  return { run, free, get primed() { return primed; } };
}

declareProgram(FULL_VERT, TAA_FRAG);
