// THE ACTOR LAB'S HEAD SHADERS AND FACE PAINTER.
//
// The head itself (skull, ears, neck and hair, in three levels) is the game's, in
// client/game/js/panels/actor-head.js; the lab draws it from there. What stays here is what the
// lab draws it with: a shader pair lit like the lab's body, and a face texture painted per person
// on a canvas, the way GoldenEye put a photograph on a low head, at 512 px instead of 64.
// docs/proposals/street-figure-heads.md is the plan for bringing both to the game.
//
// Units are the bake's: metres, Y up, the figure facing +Z with its left hand on +X.

import { FACE, HAIRLINE_GLSL } from '../../client/game/js/panels/actor-head.js';
import { FACE_GLSL } from '../../client/game/js/panels/actor-faces.js';

export { FACE };
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function mulberry(s) {
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Shaders ─────────────────────────────────────────────────────────────────────────────────────────
// The lighting is the lab's body FRAG's, line for line, so the head doesn't look pasted on.
export const HEAD_VERT = `#version 300 es
precision highp float;
in vec3 aP;
in vec3 aN;
in vec2 aUV;
in float aF;
in float aW;
in float aE;
in float aX;
uniform mat4 uVP;
uniform mat4 uMH;
uniform mat4 uMN;
uniform float uEarPoint;
uniform float uHideEars;
uniform float uScarf;
out vec3 vW;
out vec3 vN;
out vec3 vRest;
out vec3 vRestN;
out vec2 vUV;
out float vAux;
flat out int vF;
void main() {
  int f = int(aF + 0.5);
  vec3 p = aP;
  vF = f;
  vRestN = aN;
  vUV = aUV;
  vAux = aX;
  if (f == 8) {
    if (uHideEars > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vW = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); vRest = p; return; }
    if (uEarPoint > 0.5) p += vec3(sign(p.x) * 0.011, 0.028, -0.02) * aE;
  }
  // A scarf is wound round the neck, so it stands off it.
  if (f == 12 && uScarf > 0.5) {
    float k = 1.0 + 0.3 * (1.0 - smoothstep(1.505, 1.53, p.y));
    p.x *= k;
    p.z = -0.018 + (p.z + 0.018) * k;
  }
  vec4 w = mix(uMN * vec4(p, 1.0), uMH * vec4(p, 1.0), aW);
  vN = normalize(mix(mat3(uMN) * aN, mat3(uMH) * aN, aW));
  vW = w.xyz;
  vRest = p;
  gl_Position = uVP * w;
}`;

export const HEAD_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec3 vW;
in vec3 vN;
in vec3 vRest;
in vec3 vRestN;
in vec2 vUV;
in float vAux;
flat in int vF;
uniform sampler2D uFace;
// The game's faces: a layout's cell in the atlas, tinted (FACE_GLSL in actor-faces.js). Off, the
// face is the canvas painted for this person.
uniform int uAtlasOn;
uniform vec4 uCell;
uniform vec3 uLip;
uniform vec3 uLipstick;
uniform vec3 uIris;
uniform float uMakeup;
uniform sampler2D uGlowT;
uniform float uGlowK;
uniform vec3 uSkin;
uniform vec3 uHair;
uniform vec3 uKey;
uniform vec3 uKeyC;
uniform vec3 uSky;
uniform vec3 uGnd;
uniform vec3 uRimC;
uniform vec3 uEye;
uniform float uWet;
uniform float uSeed;
uniform int uStyle;
uniform float uMarks;
uniform float uScarf;
uniform vec3 uScarfC;
out vec4 outColor;
float h1(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h1(i), h1(i + vec3(1, 0, 0)), f.x), mix(h1(i + vec3(0, 1, 0)), h1(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h1(i + vec3(0, 0, 1)), h1(i + vec3(1, 0, 1)), f.x), mix(h1(i + vec3(0, 1, 1)), h1(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float sq(float x) { return x * x; }
${FACE_GLSL}
${HAIRLINE_GLSL}
// The hair's colour at a point, for the shell and for the scalp under its edge alike.
vec3 hairAt(vec3 r, float psi) {
  float strand = uStyle == 4
    ? vnoise(vec3(r.x * 320.0, r.y * 60.0 - r.z * 20.0, uSeed))
    : vnoise(vec3(psi * 40.0, r.y * 14.0, uSeed)) * 0.6 + vnoise(vec3(psi * 110.0, r.y * 30.0, uSeed + 7.0)) * 0.4;
  // Long hair below the skull runs straight down.
  if (uStyle == 3 && r.y < 1.62) strand = vnoise(vec3(atan(r.x, -r.z) * 60.0, r.y * 6.0, uSeed));
  return uHair * (0.68 + 0.6 * strand);
}
void main() {
  vec3 r = vRest;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 col = uSkin;
  vec3 glow = vec3(0.0);
  float spec = 0.0, ao = 1.0;
  bool hair = vF == 9;
  float psi = atan(abs(r.x), r.z + 0.006);
  if (hair) {
    float hl = hairlineAt(r);
    col = hairAt(r, psi);
    if (uStyle == 1) col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.0012, abs(r.x - 0.024))) * smoothstep(1.7, 1.72, r.y) * smoothstep(-0.03, 0.02, r.z);
    // Where the shell thins to its edge the scalp shows through; cut sides are mostly skin.
    ao = mix(0.85, 1.0, smoothstep(hl + 0.004, hl + 0.016, r.y));
    if (uStyle == 4) {
      float cut = smoothstep(0.04, 0.05, abs(r.x)) * (1.0 - smoothstep(1.708, 1.722, r.y));
      col = mix(col, mix(uSkin, uHair * 0.5, 0.5 + 0.3 * vnoise(r * 900.0)), cut);
    }
  } else {
    float wt = vF == 7 ? smoothstep(0.1, 0.4, vRestN.z) : 0.0;
    if (uAtlasOn == 1) {
      float wet;
      vec3 fc = faceColour(texture(uFace, uCell.xy + clamp(vUV, 0.0, 1.0) * uCell.zw), vRest, uSkin, uHair, uLip, uLipstick, uMakeup, uIris, wet);
      col = mix(uSkin, fc, wt);
      spec = wet * 2.0 * wt;
    } else {
      vec4 tx = texture(uFace, vUV);
      col = mix(uSkin, tx.rgb, wt);
      spec = (1.0 - tx.a) * 2.0 * wt;
      glow = texture(uGlowT, vUV).rgb * uGlowK * wt;
    }
    if (vF == 7) {
      // The scalp under the hair, with a soft broken edge for a hairline.
      float hl = hairlineAt(r);
      float jit = 0.0026 * (vnoise(vec3(psi * 70.0, r.y * 400.0, uSeed)) - 0.5);
      float sc = smoothstep(hl - 0.0025, hl + 0.0025, r.y + jit);
      col = mix(col, hairAt(r, psi) * 0.95, sc);
      ao = mix(ao, 0.88, sc);
      col *= 1.0 - 0.18 * smoothstep(1.534, 1.522, r.y);
    } else if (vF == 8) {
      col = uSkin * vec3(1.03, 0.94, 0.92) * (1.0 - 0.3 * vAux);
      ao = 1.0 - 0.3 * vAux;
    } else if (vF == 12) {
      // The jaw's shadow on the throat.
      float under = smoothstep(1.49, 1.535, r.y) * smoothstep(-0.02, 0.025, r.z);
      col = uSkin * (1.0 - 0.3 * under);
      ao = 1.0 - 0.25 * under;
      // A Wildblood's marks carry on down the neck as bands, curving round it.
      if (uMarks > 0.5) col = mix(col, col * vec3(0.5, 0.36, 0.42), 0.6 * smoothstep(0.62, 0.85, sin(r.y * 260.0 + abs(atan(r.x, r.z)) * 1.5 + vnoise(r * 30.0 + uSeed) * 2.0) * 0.5 + 0.5));
      if (uScarf > 0.5 && r.y < 1.53) {
        col = uScarfC * (0.8 + 0.2 * step(0.5, fract(r.y * 55.0))) * (0.85 + 0.3 * vnoise(r * 150.0));
        ao = 1.0;
        spec = 0.0;
      }
    }
  }
  float nk = dot(n, uKey);
  float wrap = max(0.0, (nk + 0.35) / 1.35);
  vec3 amb = mix(uGnd, uSky, n.y * 0.5 + 0.5);
  vec3 v = normalize(uEye - vW);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 lit = col * (amb * ao + uKeyC * wrap * (1.0 - 0.3 * uWet)) + rim * uRimC;
  vec3 hv = normalize(uKey + v);
  float nh = max(dot(n, hv), 0.0);
  if (!hair) {
    // Light that gets under the skin warms the edge of the shadow; eyes and lips are wet.
    lit += col * vec3(0.3, 0.1, 0.06) * uKeyC * (smoothstep(-0.45, 0.1, nk) - smoothstep(0.1, 0.7, nk)) * 0.8;
    lit += uKeyC * (pow(nh, 28.0) * (0.07 + 0.25 * uWet) + pow(nh, 120.0) * spec * 1.2);
  } else {
    lit += uKeyC * 0.12 * exp(-sq((nh - 0.72) / 0.12)) * (0.4 + dot(uHair, vec3(0.33))) * (uStyle == 1 || uStyle == 4 ? 1.8 : 1.0);
    lit += uKeyC * pow(nh, 40.0) * (0.03 + 0.3 * uWet);
  }
  lit += glow;
  outColor = vec4(pow(max(lit, vec3(0.0)), vec3(0.95)), 1.0);
}`;

// ── The face, painted ───────────────────────────────────────────────────────────────────────────────
// One canvas per person, 512 x 640, a front projection of FACE's box (2560 px a metre both ways).
// Colours are 0..255 sRGB like the lab's. The alpha is a wetness mask: 1 is skin, lower is shinier
// (the eyes, the lips), which HEAD_FRAG reads as specular. A second, smaller canvas holds what
// glows: an Ascendant's implant, a Wildblood's eyes. Painted in metres through the canvas transform.
const TEX_W = 512, TEX_H = 640, PX = TEX_W / (FACE.x1 - FACE.x0);
const cl = (v) => Math.max(0, Math.min(255, v));
const rgb = (c, a = 1) => `rgba(${cl(c[0]) | 0},${cl(c[1]) | 0},${cl(c[2]) | 0},${a})`;
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const mulc = (a, k) => a.map((v, i) => v * (Array.isArray(k) ? k[i] : k));
function newCanvas(w, h, scale) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, -scale, -FACE.x0 * scale, FACE.y1 * scale);
  return { cv, ctx };
}
// A soft elliptical spot, `a` opaque at its centre.
function blob(ctx, x, y, rx, ry, col, a, rot = 0) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgb(col, a)); g.addColorStop(1, rgb(col, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
  ctx.restore();
}
const both = (f) => { f(1); f(-1); };
const quad = (p0, p1, p2, t) => [0, 1].map((i) => (1 - t) * (1 - t) * p0[i] + 2 * (1 - t) * t * p1[i] + t * t * p2[i]);
// A tapered stroke along a quadratic curve: width w(t), filled.
function taper(ctx, p0, p1, p2, w, steps = 18) {
  const L = [], R = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, p = quad(p0, p1, p2, t), q = quad(p0, p1, p2, Math.min(1, t + 0.01)), o = quad(p0, p1, p2, Math.max(0, t - 0.01));
    let tx = q[0] - o[0], ty = q[1] - o[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const hw = w(t) / 2;
    L.push([p[0] - ty * hw, p[1] + tx * hw]); R.push([p[0] + ty * hw, p[1] - tx * hw]);
  }
  ctx.beginPath();
  ctx.moveTo(...L[0]);
  for (const p of L.slice(1)) ctx.lineTo(...p);
  for (const p of R.reverse()) ctx.lineTo(...p);
  ctx.closePath(); ctx.fill();
}
function eyePath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(s * 0.0165, 1.6386);
  ctx.bezierCurveTo(s * 0.0212, 1.6458, s * 0.0385, 1.6468, s * 0.0463, 1.6409);
  ctx.bezierCurveTo(s * 0.0395, 1.6358, s * 0.0235, 1.635, s * 0.0165, 1.6386);
  ctx.closePath();
}
function upperLid(ctx, s, from = 0) {
  // the upper lid's curve, optionally from part way along (for the heavier outer half)
  const P = [[s * 0.0165, 1.6386], [s * 0.0212, 1.6458], [s * 0.0385, 1.6468], [s * 0.0463, 1.6409]];
  const at = (t) => [0, 1].map((i) => (1 - t) ** 3 * P[0][i] + 3 * (1 - t) ** 2 * t * P[1][i] + 3 * (1 - t) * t * t * P[2][i] + t ** 3 * P[3][i]);
  ctx.beginPath();
  ctx.moveTo(...at(from));
  for (let i = 1; i <= 20; i++) ctx.lineTo(...at(from + ((1 - from) * i) / 20));
  return at;
}
// The beard's ground, 0..1: the jaw, chin and upper lip, up the cheeks to a line from the corner of
// the nose to the sideburn, never on the lips.
function beardMask(x, y) {
  const ax = Math.abs(x);
  const le = (x / 0.0275) ** 2 + ((y - 1.5648) / 0.0098) ** 2;
  const lip = sstep(1.0, 1.35, le);
  const top = ax < 0.024 ? 1.5835 : ax < 0.066 ? 1.58 + ((ax - 0.024) / 0.042) * 0.028 : 1.608 + ((ax - 0.066) / 0.01) * 0.012;
  return sstep(top + 0.0025, top - 0.0035, y) * lip * sstep(0.075, 0.066, ax);
}

// `p`: { skin, hair, iris, glow (0..255 rgb), age, beard (0 none, 1 stubble, 2 full), makeup,
// lipTint, mood (-1 frown .. 1 smile), brow (-1 stern .. 1 worried), order, implant, seed }.
// Returns { face, glow } canvases; glow is null when nothing glows.
export function paintFace(p) {
  const R = mulberry(Math.floor(p.seed * 7919) + 17);
  const skin = p.skin, age = p.age;
  const { cv, ctx } = newCanvas(TEX_W, TEX_H, PX);
  ctx.fillStyle = rgb(skin); ctx.fillRect(FACE.x0, FACE.y0, FACE.x1 - FACE.x0, FACE.y1 - FACE.y0);
  const warm = mulc(skin, [1.08, 0.82, 0.8]), shade = mulc(skin, [0.55, 0.45, 0.45]);
  const light = mixc(skin, [255, 248, 240], 0.3);

  // ── Tone: a warmer middle of the face, a lighter forehead, and blotches too soft to be marks ──
  for (let i = 0; i < 26; i++) blob(ctx, (R() - 0.5) * 0.15, 1.53 + R() * 0.2, 0.006 + R() * 0.012, 0.006 + R() * 0.012, R() < 0.5 ? warm : light, 0.08);
  both((s) => blob(ctx, s * 0.044, 1.607, 0.021, 0.016, warm, 0.26));
  blob(ctx, 0, 1.6, 0.011, 0.012, warm, 0.22);
  blob(ctx, 0, 1.69, 0.05, 0.02, light, 0.12);
  ctx.globalCompositeOperation = 'multiply';
  // a cooler, darker jaw and the shadow under the chin
  const g = ctx.createLinearGradient(0, 1.54, 0, 1.517);
  g.addColorStop(0, rgb([255, 255, 255], 0)); g.addColorStop(1, rgb(mulc(skin, 0.7), 0.5));
  ctx.fillStyle = g; ctx.fillRect(FACE.x0, 1.515, 0.2, 0.025);

  // ── Shading the geometry can't: sockets, the sides and underside of the nose, the mouth ──
  both((s) => {
    blob(ctx, s * 0.02, 1.6455, 0.009, 0.007, shade, 0.35);             // inner corner, under the brow
    blob(ctx, s * 0.031, 1.6475, 0.018, 0.006, shade, 0.22);            // under the brow
    blob(ctx, s * 0.031, 1.6342, 0.014, 0.004, shade, 0.18 + 0.32 * age); // under the eye
    blob(ctx, s * 0.0125, 1.618, 0.004, 0.02, shade, 0.16);             // the side of the nose
    blob(ctx, s * 0.0255, FACE.mouthY, 0.004, 0.003, shade, 0.4);       // mouth corners
  });
  blob(ctx, 0, 1.5845, 0.012, 0.003, shade, 0.3);                       // under the nose
  blob(ctx, 0, 1.5525, 0.015, 0.003, shade, 0.32);                      // under the lower lip

  // ── Nose ──
  ctx.filter = 'blur(1px)';
  both((s) => {
    blob(ctx, s * 0.0076, 1.5876, 0.0036, 0.0018, [40, 24, 24], 0.95, s * 0.35);
    ctx.strokeStyle = rgb(shade, 0.35); ctx.lineWidth = 0.0009;
    ctx.beginPath(); ctx.arc(s * 0.0158, 1.5925, 0.0068, s > 0 ? -0.9 : Math.PI - 1.6, s > 0 ? 1.6 : Math.PI + 0.9); ctx.stroke();
  });
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  blob(ctx, 0, 1.6005, 0.0045, 0.004, light, 0.3);
  ctx.strokeStyle = rgb(light, 0.12); ctx.lineWidth = 0.0022;
  ctx.beginPath(); ctx.moveTo(0, 1.632); ctx.lineTo(0, 1.606); ctx.stroke();

  // ── Age ──
  ctx.globalCompositeOperation = 'multiply';
  const line = (pts, w, a, blur = 0.6) => {
    ctx.filter = `blur(${blur}px)`;
    ctx.strokeStyle = rgb(mulc(skin, 0.6), a); ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(...pts[0]);
    if (pts.length === 3) ctx.quadraticCurveTo(...pts[1], ...pts[2]); else ctx.lineTo(...pts[1]);
    ctx.stroke(); ctx.filter = 'none';
  };
  // Folds, not lines: at this size a hard line reads as a scar. Each is a broad soft shade.
  both((s) => line([[s * 0.0205, 1.5915], [s * 0.031, 1.58], [s * 0.0298, 1.5635]], 0.003, 0.05 + 0.25 * age, 3));
  if (age > 0.4) {
    for (let k = 0; k < 3; k++) {
      const y = 1.676 + k * 0.0075 + (R() - 0.5) * 0.002;
      line([[-0.032, y - 0.001], [0, y + 0.0015], [0.032, y - 0.001]], 0.0009, (age - 0.4) * 0.4, 1.2);
    }
  }
  if (age > 0.35) both((s) => { for (let k = -1; k <= 1; k++) line([[s * 0.048, 1.6405 + k * 0.0018], [s * 0.0555, 1.6413 + k * 0.0038]], 0.0006, (age - 0.35) * 0.45, 0.9); });
  if (age > 0.55) both((s) => line([[s * 0.022, 1.6345], [s * 0.031, 1.6315], [s * 0.042, 1.635]], 0.0012, (age - 0.55) * 0.4, 1.5));
  if (age > 0.7) both((s) => blob(ctx, s * 0.029, 1.555, 0.004, 0.007, mulc(skin, 0.7), (age - 0.7) * 0.6));
  ctx.globalCompositeOperation = 'source-over';
  if (age > 0.75) for (let i = 0; i < 9; i++) blob(ctx, (R() - 0.5) * 0.11, 1.6 + R() * 0.1, 0.0015 + R() * 0.0015, 0.0015, mulc(skin, [0.8, 0.66, 0.55]), 0.35);

  // ── Wildblood marks: a pigment the body grew, laid out the way an animal's is, so it reads as
  // meant. Mirrored, soft-edged, and kept off the eyes and mouth. ──
  if (p.order === 4) paintMarks(ctx, p, R);

  // ── Beard ──
  if (p.beard > 0) {
    const bc = mulc(mixc(p.hair, skin, 0.15), 0.8);
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 260; i++) {
      const x = (R() - 0.5) * 0.15, y = 1.517 + R() * 0.095, m = beardMask(x, y);
      if (m > 0.05) blob(ctx, x, y, 0.004, 0.004, mixc([255, 255, 255], mulc(bc, [0.95, 1.0, 1.08]), 0.5), 0.12 * m);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (p.beard >= 2) {
      ctx.filter = 'blur(2px)';
      for (let i = 0; i < 900; i++) {
        const x = (R() - 0.5) * 0.15, y = 1.517 + R() * 0.095, m = beardMask(x, y);
        if (m > 0.1) blob(ctx, x, y, 0.0025, 0.0025, bc, 0.5 * m);
      }
      ctx.filter = 'none';
    }
    const n = p.beard >= 2 ? 7000 : 4000;
    ctx.lineWidth = 0.00028;
    for (let i = 0; i < n; i++) {
      const x = (R() - 0.5) * 0.15, y = 1.517 + R() * 0.095, m = beardMask(x, y);
      if (R() > m) continue;
      ctx.strokeStyle = rgb(mulc(bc, 0.7 + 0.6 * R()), p.beard >= 2 ? 0.6 : 0.45);
      const len = p.beard >= 2 ? 0.0022 + R() * 0.0018 : 0.0007, ang = -Math.PI / 2 + Math.sign(x) * 0.3 + (R() - 0.5) * 0.6;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); ctx.stroke();
    }
  }

  // ── Lips ──
  const lipC = p.makeup ? p.lipTint : mixc(mulc(skin, [0.86, 0.55, 0.55]), mulc(skin, 0.72), clamp01((120 - skin[0]) / 120) * 0.5);
  const corner = FACE.mouthY + (p.mood || 0) * 0.0016;
  ctx.filter = 'blur(0.7px)';
  ctx.fillStyle = rgb(mulc(lipC, 0.84));
  ctx.beginPath();
  ctx.moveTo(-0.0245, corner);
  ctx.bezierCurveTo(-0.018, 1.5715, -0.009, 1.5762, -0.0055, 1.5757);
  ctx.quadraticCurveTo(-0.002, 1.5754, 0, 1.5741);
  ctx.quadraticCurveTo(0.002, 1.5754, 0.0055, 1.5757);
  ctx.bezierCurveTo(0.009, 1.5762, 0.018, 1.5715, 0.0245, corner);
  ctx.quadraticCurveTo(0, FACE.mouthY - 0.0008, -0.0245, corner);
  ctx.fill();
  ctx.fillStyle = rgb(lipC);
  ctx.beginPath();
  ctx.moveTo(-0.0245, corner);
  ctx.quadraticCurveTo(0, FACE.mouthY - 0.0008, 0.0245, corner);
  ctx.bezierCurveTo(0.017, 1.5575, 0.008, 1.5552, 0, 1.5552);
  ctx.bezierCurveTo(-0.008, 1.5552, -0.017, 1.5575, -0.0245, corner);
  ctx.fill();
  ctx.filter = 'none';
  blob(ctx, 0.002, 1.5595, 0.008, 0.0018, mixc(lipC, [255, 255, 255], 0.5), 0.35);
  ctx.strokeStyle = rgb(mulc(skin, 0.28), 0.85); ctx.lineWidth = 0.0008;
  ctx.beginPath(); ctx.moveTo(-0.0245, corner); ctx.quadraticCurveTo(0, FACE.mouthY - 0.0008, 0.0245, corner); ctx.stroke();

  // ── Eyes ──
  both((s) => paintEye(ctx, p, s, skin));
  // ── Brows ──
  both((s) => paintBrow(ctx, p, s, skin, R));

  if (p.implant) {
    // An Ascendant's temple plate, back from the left eye.
    ctx.fillStyle = rgb([34, 36, 46]);
    ctx.beginPath();
    ctx.moveTo(0.0468, 1.6372); ctx.lineTo(0.0685, 1.6385); ctx.lineTo(0.0688, 1.6462); ctx.lineTo(0.0475, 1.6448); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgb([110, 115, 130], 0.8); ctx.lineWidth = 0.0004; ctx.stroke();
    for (const x of [0.0505, 0.0655]) blob(ctx, x, 1.6418, 0.0007, 0.0007, [150, 155, 170], 0.9);
  }

  // ── Wetness: the eyes and lips are shiny; the alpha carries it ──
  ctx.globalCompositeOperation = 'destination-out';
  both((s) => { eyePath(ctx, s); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill(); });
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 1.5615, 0.022, 0.0075, 0, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // ── What glows ──
  let glow = null;
  if (p.implant || p.order === 4) {
    const G = newCanvas(TEX_W / 2, TEX_H / 2, PX / 2);
    G.ctx.fillStyle = '#000'; G.ctx.fillRect(FACE.x0, FACE.y0, 0.2, 0.25);
    const gc = p.implant ? p.glow : p.iris;
    G.ctx.save(); eyePath(G.ctx, 1); G.ctx.clip();
    blob(G.ctx, FACE.irisX, FACE.eyeY + 0.0003, FACE.iris, FACE.iris, gc, 0.9);
    G.ctx.restore();
    if (p.order === 4) { G.ctx.save(); eyePath(G.ctx, -1); G.ctx.clip(); blob(G.ctx, -FACE.irisX, FACE.eyeY + 0.0003, FACE.iris, FACE.iris, gc, 0.9); G.ctx.restore(); }
    if (p.implant) {
      G.ctx.strokeStyle = rgb(p.glow); G.ctx.lineWidth = 0.0008;
      G.ctx.beginPath(); G.ctx.moveTo(0.0478, 1.6412); G.ctx.lineTo(0.068, 1.6424); G.ctx.stroke();
    }
    glow = G.cv;
  }
  return { face: cv, glow };
}

function paintEye(ctx, p, s, skin) {
  const implant = p.implant && s > 0;
  const iris = implant ? p.glow : p.iris;
  const cx = s * FACE.irisX, cy = FACE.eyeY + 0.0003;
  ctx.save();
  eyePath(ctx, s); ctx.clip();
  // The white, shaded round the ball toward the corners.
  ctx.fillStyle = rgb(mixc(skin, [232, 226, 218], 0.82)); ctx.fill();
  const sg = ctx.createRadialGradient(cx, cy, 0.004, cx, cy, 0.018);
  sg.addColorStop(0, rgb(mulc(skin, 0.5), 0)); sg.addColorStop(1, rgb(mulc(skin, 0.5), 0.6));
  ctx.fillStyle = sg; ctx.fillRect(cx - 0.02, cy - 0.01, 0.04, 0.02);
  // The iris: lighter round the pupil, a dark ring at its edge, fibres.
  const ig = ctx.createRadialGradient(cx, cy, 0, cx, cy, FACE.iris);
  ig.addColorStop(0, rgb(mulc(iris, 1.35))); ig.addColorStop(0.45, rgb(mulc(iris, 1.1)));
  ig.addColorStop(0.85, rgb(mulc(iris, 0.78))); ig.addColorStop(1, rgb(mulc(iris, 0.35)));
  ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(cx, cy, FACE.iris, 0, TAU); ctx.fill();
  ctx.lineWidth = 0.00022;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    ctx.strokeStyle = i % 2 ? rgb(mulc(iris, 1.5), 0.2) : rgb(mulc(iris, 0.5), 0.2);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 0.0024, cy + Math.sin(a) * 0.0024); ctx.lineTo(cx + Math.cos(a) * 0.0055, cy + Math.sin(a) * 0.0055); ctx.stroke();
  }
  ctx.fillStyle = rgb([10, 9, 9]); ctx.beginPath(); ctx.arc(cx, cy, FACE.pupil * (p.order === 4 ? 0.8 : 1), 0, TAU); ctx.fill();
  // The upper lid's shadow across the top of the ball.
  const lg = ctx.createLinearGradient(0, 1.6458, 0, FACE.eyeY - 0.0005);
  lg.addColorStop(0, rgb([20, 14, 12], 0.6)); lg.addColorStop(1, rgb([20, 14, 12], 0));
  ctx.fillStyle = lg; ctx.fillRect(cx - 0.02, FACE.eyeY - 0.002, 0.04, 0.009);
  // A catchlight, the same side in both eyes.
  blob(ctx, cx - 0.0017, cy + 0.0019, 0.0011, 0.0011, [255, 255, 255], 0.95);
  ctx.restore();
  // The pink at the inner corner, the lid crease, the lid itself a touch darker.
  blob(ctx, s * 0.0172, 1.6388, 0.0013, 0.001, [215, 135, 130], 0.8);
  ctx.globalCompositeOperation = 'multiply';
  ctx.filter = 'blur(1px)';
  ctx.strokeStyle = rgb(mulc(skin, 0.6), 0.5); ctx.lineWidth = 0.0008;
  ctx.beginPath(); ctx.moveTo(s * 0.0175, 1.6405);
  ctx.bezierCurveTo(s * 0.0225, 1.6492, s * 0.0395, 1.6504, s * 0.0478, 1.6432); ctx.stroke();
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  // Lashes: the line, heavier toward the outer corner, and a few lashes off it.
  const lash = mixc(mulc(p.hair, 0.3), [12, 10, 10], 0.6);
  ctx.strokeStyle = rgb(lash, 0.92); ctx.lineCap = 'round';
  ctx.lineWidth = 0.001; upperLid(ctx, s); ctx.stroke();
  ctx.lineWidth = p.makeup ? 0.0019 : 0.0014;
  const at = upperLid(ctx, s, 0.5); ctx.stroke();
  ctx.lineWidth = 0.0003;
  for (let i = 0; i < 12; i++) {
    const t = 0.45 + (i / 11) * 0.55, q = at(t);
    ctx.beginPath(); ctx.moveTo(...q); ctx.lineTo(q[0] + s * 0.0012 * t, q[1] + 0.0014); ctx.stroke();
  }
  if (p.makeup) {
    ctx.lineWidth = 0.0012;
    ctx.beginPath(); ctx.moveTo(s * 0.044, 1.6418); ctx.lineTo(s * 0.0528, 1.6452); ctx.stroke();
    blob(ctx, s * 0.031, 1.6462, 0.016, 0.0055, mulc(p.lipTint, 0.7), 0.35);
  }
  // The lower lid.
  ctx.strokeStyle = rgb(mulc(skin, 0.55), 0.45); ctx.lineWidth = 0.0005;
  ctx.beginPath(); ctx.moveTo(s * 0.0463, 1.6409); ctx.bezierCurveTo(s * 0.0395, 1.6358, s * 0.0235, 1.635, s * 0.0165, 1.6386); ctx.stroke();
  ctx.lineCap = 'butt';
}

function paintBrow(ctx, p, s, skin, R) {
  const tilt = p.brow || 0;
  const P0 = [s * 0.0105, 1.6532 + tilt * 0.003], P1 = [s * 0.03, 1.6607], P2 = [s * 0.0505, 1.6548 - tilt * 0.0015];
  const w = (t) => 0.0044 * (1 - t) + 0.0012 * t + 0.0008 * Math.sin(Math.PI * t);
  const grey = sstep(0.6, 1, p.age) * 0.6;
  const bc = mixc(mixc(mulc(p.hair, 0.82), skin, 0.12), [150, 148, 144], grey);
  ctx.fillStyle = rgb(bc, 0.3);
  ctx.filter = 'blur(1px)'; taper(ctx, P0, P1, P2, w); ctx.filter = 'none';
  ctx.lineWidth = 0.0003; ctx.lineCap = 'round';
  for (let i = 0; i < 280; i++) {
    const t = R() ** 0.85, c = quad(P0, P1, P2, t), d = quad(P0, P1, P2, Math.min(1, t + 0.02));
    const tx = d[0] - c[0], ty = d[1] - c[1], l = Math.hypot(tx, ty) || 1;
    const off = (R() - 0.5) * w(t) * 0.9;
    const x = c[0] - (ty / l) * off, y = c[1] + (tx / l) * off;
    // At the inner end the hairs grow up; along the rest they lie along the brow, outward.
    const along = Math.atan2(ty, tx), up = Math.PI / 2 - s * 0.25;
    const ang = (t < 0.15 ? up : along + s * 0.25) + (R() - 0.5) * 0.4;
    const len = 0.0024 + R() * 0.0018;
    ctx.strokeStyle = rgb(mulc(bc, 0.8 + 0.4 * R()), 0.5 + 0.3 * R());
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

// The kinds, from the person's own seed: tiger stripes running in from the sides of the face,
// rosettes like a leopard's, or tear lines like a cheetah's with a darker mask round the eyes;
// and sometimes hardened skin, a fine scale over the temples and the brow.
function paintMarks(ctx, p, R) {
  const skin = p.skin;
  const kind = ['stripes', 'rosettes', 'tears'][Math.floor(p.seed * 3) % 3];
  const scales = (p.seed * 7) % 1 < 0.45;
  const ink = mulc(skin, [0.42, 0.3, 0.36]);
  ctx.fillStyle = rgb(ink, 0.88);
  ctx.filter = 'blur(2px)';
  if (kind === 'stripes') {
    const S = [
      // start x, start y, end x, drop, width
      [0.068, 1.69, 0.036, 0.006, 0.0045],
      [0.071, 1.672, 0.052, 0.004, 0.0038],
      [0.069, 1.626, 0.04, -0.004, 0.0045],
      [0.067, 1.603, 0.036, 0.006, 0.004],
      [0.061, 1.574, 0.04, 0.01, 0.0035],
    ];
    const jit = S.map(() => [(R() - 0.5) * 0.002, (R() - 0.5) * 0.004, 0.8 + R() * 0.4]);
    both((s) => {
      S.forEach(([x0, y0, x1, drop, W], i) => {
        const [dy, bend, k] = jit[i];
        const p0 = [s * x0, y0 + dy], p2 = [s * x1, y0 + dy - drop], p1 = [s * (x0 + x1) / 2, (p0[1] + p2[1]) / 2 + bend];
        taper(ctx, p0, p1, p2, (t) => 1.6 * W * k * Math.pow(1 - t, 0.7) * Math.min(1, 0.4 + t * 5) * (1 + 0.2 * Math.sin(t * 9 + i)));
      });
      taper(ctx, [s * 0.006, 1.704], [s * 0.007, 1.69], [s * 0.003, 1.675], (t) => 0.003 * (1 - t));
      taper(ctx, [s * 0.013, 1.5265], [s * 0.01, 1.536], [s * 0.004, 1.5445], (t) => 0.0028 * (1 - t));
    });
  } else if (kind === 'rosettes') {
    const spots = [[0.056, 1.692], [0.066, 1.668], [0.043, 1.7], [0.061, 1.628], [0.052, 1.606], [0.064, 1.59], [0.046, 1.581], [0.058, 1.556], [0.04, 1.545], [0.028, 1.69]];
    const jit = spots.map(() => [(R() - 0.5) * 0.003, (R() - 0.5) * 0.003, 0.8 + R() * 0.5, R() * TAU]);
    both((s) => spots.forEach(([x, y], i) => {
      const [jx, jy, k, a0] = jit[i], cx = s * (x + jx), cy = y + jy;
      blob(ctx, cx, cy, 0.0018 * k, 0.0018 * k, ink, 0.35);
      for (let j = 0; j < 5; j++) {
        if (j === 2) continue; // a rosette is a broken ring
        const a = a0 + (j / 5) * TAU;
        blob(ctx, cx + Math.cos(a) * 0.003 * k, cy + Math.sin(a) * 0.003 * k, 0.0014 * k, 0.0011 * k, ink, 0.85, a);
      }
    }));
  } else {
    both((s) => {
      // A cheetah's: from the inner corner of the eye, round the nostril, to the corner of the mouth.
      taper(ctx, [s * 0.0178, 1.6368], [s * 0.0245, 1.6], [s * 0.0285, 1.5685], (t) => 0.0052 * (1 - 0.55 * t) * Math.min(1, 0.45 + t * 5));
      blob(ctx, s * 0.031, FACE.eyeY + 0.001, 0.019, 0.009, ink, 0.3);
    });
  }
  ctx.filter = 'none';
  if (scales) {
    // A fine scale: dark seams between, light on each scale's upper edge.
    const c = 0.0034;
    both((s) => {
      for (let row = 0; row < 22; row++) for (let col = 0; col < 12; col++) {
        const x = 0.04 + col * c + (row % 2) * c * 0.5, y = 1.638 + row * c * 0.85;
        const m = sstep(0.038, 0.05, x) * sstep(1.636, 1.65, y) * (1 - sstep(1.69, 1.705, y));
        if (m < 0.05) continue;
        ctx.strokeStyle = rgb(mulc(skin, 0.55), 0.45 * m); ctx.lineWidth = 0.00035;
        ctx.beginPath(); ctx.arc(s * x, y, c * 0.55, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
        ctx.strokeStyle = rgb(mixc(skin, [255, 250, 240], 0.35), 0.35 * m);
        ctx.beginPath(); ctx.arc(s * x, y + 0.0004, c * 0.42, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      }
    });
  }
}
