// GLASS 2 · THE BALLPARK. Deadball's park drawn by WebGL2 (the Grandstand, gameday-grandstand.js).
//
// The park is lit the way a night game is: six light towers are the only lights, each a bank
// of lamps the venue says are working or not, and every surface is lit by them in linear light
// with a GGX highlight. The frame goes into hdr.js's multisampled float target, so a lamp can be
// twenty times brighter than white and bloom off it, and this file's own last pass takes the
// filmic curve in linear light and encodes for the screen.
//
//   · the park is built once from the venue by ballpark-mesh.js (pure, so the gate checks it);
//   · the field is painted in the shader: grass with mowing stripes that change with the
//     camera's direction, the warning track, the foul lines, and the infield canvas
//     (diamond/dirt.js) laid over it;
//   · the crowd is one figure per pose, instanced over every occupied seat;
//   · the scoreboard is a face of lamps lit from a 240×84 mask of the line score
//     (diamond/board.js), redrawn when the game changes.
//
// The frame, in order (docs/proposals/deadball-glass2.md, Lighting and the frame):
//
//   1. shadows: four of the towers draw perspective maps of whatever casts (gl/spotshadow.js);
//   2. the main pass into hdr.js's target: the sky, the park, the crowd, the backstop net, each
//      through the night air, which is height fog with the towers' light scattered in it (fog.js);
//   3. the depth the frame was drawn with, resolved into a texture for the lens and the occlusion;
//   4. ambient occlusion from that depth at half size (ssao.js);
//   5. bloom off the lamps (hdr.js), then the lens, the curve and the grade (gl/broadcast.js).
//
// Nothing here decides anything: it draws the park through a shot (diamond/camera.js).
// `createBallparkRenderer` returns null with no WebGL2, no float target, or a shader that won't
// build, and the view falls back to the 2-D Gameday.
//
// ⚠ NO FACE CULLING, as in arena.js: the builders don't keep one winding, and every material
// here is lit from the side that faces the eye.

import { buildPark, crowdMesh, STRIDE, CROWD_STRIDE, CROWD_VERTEX, MAT } from './ballpark-mesh.js';
import { paintInfield, DIRT_RECT } from '../diamond/dirt.js';
import { boardLamps, BOARD_W, BOARD_H } from '../diamond/board.js';
import { shotMatrices, shotOf, inv4 } from '../diamond/camera.js';
import { createHDRLayer } from './hdr.js';
import { HEIGHT_FOG_GLSL, LIGHT_SHAFT_GLSL } from './fog.js';
import { createSpotShadows, SPOT_SHADOW_GLSL } from './spotshadow.js';
import { createDepthSSAO, ssaoConstants } from './ssao.js';
import { createBroadcastPass } from './broadcast.js';
import { makeVertexStream } from './stream.js';
import { declareProgram, prewarmPrograms, takeWarm } from './programs.js';

const FACE = '"Arial Narrow", "Roboto Condensed", Arial, sans-serif';

// ── shaders ─────────────────────────────────────────────────────────────────
const LIT_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aCol;
layout(location = 4) in float aMat;
uniform mat4 uVP;
out vec3 vPos; out vec3 vNrm; out vec2 vUv; out vec3 vCol; flat out int vMat;
void main() { vPos = aPos; vNrm = aNrm; vUv = aUv; vCol = aCol; vMat = int(aMat + 0.5); gl_Position = uVP * vec4(aPos, 1.0); }`;

// What every lit pass shares: the six towers, the sky's ambient, and the night air.
const LIGHTS_GLSL = `
const float PI = 3.14159265;
uniform vec3 uLPos[6]; uniform vec3 uLCol[6]; uniform vec3 uLDir[6];
uniform vec3 uEye; uniform vec3 uSkyUp; uniform vec3 uSkyDn;
uniform vec3 uFogCol; uniform float uFogDens; uniform float uFogH; uniform float uShaft; uniform float uShaftReach;
// a flood's cone: full inside 32° of its axis, falling to a spill at 63°
float spotOf(int i, vec3 L, float spill) { return mix(spill, 1.0, smoothstep(0.45, 0.85, dot(-L, uLDir[i]))); }
${HEIGHT_FOG_GLSL}
${LIGHT_SHAFT_GLSL}
// The air between the eye and P: the haze, thicker near the ground, and each tower's light
// scattered toward the eye. fog.js works with height on z, so the points go in as xzy.
vec3 airOf(vec3 c, vec3 P) {
  float f = heightFog(uEye.y, P.y, length(P - uEye), uFogDens, uFogH);
  vec3 sc = vec3(0.0);
  for (int i = 0; i < 6; i++) sc += uLCol[i] * lightShaft(uEye.xzy, P.xzy, uLPos[i].xzy, uShaftReach, uFogDens, uFogH);
  return mix(c, uFogCol, f) + sc * uShaft;
}
`;

const LIT_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNrm; in vec2 vUv; in vec3 vCol; flat in int vMat;
uniform sampler2D uTex; uniform sampler2D uDirt; uniform sampler2D uGrass; uniform sampler2D uBoard;
uniform int uTextured; uniform float uAlphaTest; uniform float uAlpha; uniform float uEmis;
uniform vec3 uFence; uniform vec2 uBoardRes; uniform vec3 uBoardOn;
uniform int uLSh[6]; uniform int uSpotN;
out vec4 o;
${LIGHTS_GLSL}
${SPOT_SHADOW_GLSL}
float ggxD(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float visSG(float NoV, float NoL, float a) { float a2 = a * a; float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2); float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2); return 0.5 / max(gv + gl, 1e-4); }
// the fence's distance at a bearing from straight-away centre: the venue's line, centre and curve
float fenceAt(float th) { return uFence.y - (uFence.y - uFence.x) * pow(clamp(abs(th) / 0.7853982, 0.0, 1.0), uFence.z); }
void main() {
  vec3 N = normalize(vNrm);
  vec3 V = normalize(uEye - vPos);
  vec4 tex = vec4(1.0);
  if (uTextured == 1) { tex = texture(uTex, vUv); if (tex.a < uAlphaTest) discard; }
  vec3 alb = vCol * tex.rgb;
  if (vMat == ${MAT.EMISSIVE}) { o = vec4(airOf(alb * uEmis, vPos), uAlpha * tex.a); return; }
  if (vMat == ${MAT.BOARD}) {
    // a face of lamps: each cell of the grid is one lamp, lit where the mask says
    vec2 g = vUv * uBoardRes, f = fract(g) - 0.5;
    float on = texture(uBoard, (floor(g) + 0.5) / uBoardRes).r;
    float fw = max(fwidth(g.x), fwidth(g.y));
    float disc = 1.0 - smoothstep(0.3 - fw * 0.5, 0.4 + fw * 0.5, length(f));
    disc = mix(disc, 0.42, smoothstep(0.6, 1.4, fw));
    o = vec4(airOf(mix(vec3(0.02, 0.01, 0.004), uBoardOn, on) * disc + vec3(0.003) * (1.0 - disc), vPos), 1.0);
    return;
  }
  float rough = 0.85, metal = 0.0, wrap = 0.0, f0s = 0.04, ao = 1.0;
  if (vMat == ${MAT.GROUND}) {
    // the field, painted: grass and its mowing, the track, the lines, then the infield canvas
    vec2 xz = vPos.xz;
    vec2 duv = (xz - vec2(${DIRT_RECT.x0.toFixed(1)}, ${DIRT_RECT.z0.toFixed(1)})) / ${DIRT_RECT.size.toFixed(1)};
    bool inC = all(greaterThanEqual(duv, vec2(0.0))) && all(lessThanEqual(duv, vec2(1.0)));
    vec4 dirt = inC ? texture(uDirt, duv) : vec4(0.0);
    vec4 g1 = texture(uGrass, xz / 2.4), g2 = texture(uGrass, xz / 53.0), g3 = texture(uGrass, xz / 0.8);
    float th = atan(xz.x, xz.y), r = length(xz);
    float fair = step(abs(th), 0.7854) * step(0.0, xz.y);
    // the stripes: cut in two directions, each lighter or darker as the camera looks with or
    // against the grain, the way mown grass reads on television
    vec2 vd = normalize(V.xz + 1e-5);
    float s1 = smoothstep(-0.06, 0.06, sin((xz.x + xz.y) * PI / 15.0));
    float s2 = smoothstep(-0.06, 0.06, sin((xz.x - xz.y) * PI / 15.0));
    float mow = (0.20 * (s1 * 2.0 - 1.0) * dot(vd, vec2(0.7071, 0.7071)) + 0.15 * (s2 * 2.0 - 1.0) * dot(vd, vec2(-0.7071, 0.7071))) * mix(0.5, 1.0, fair);
    vec3 grass = vec3(0.036, 0.105, 0.024) * (0.74 + 0.36 * g1.r + 0.12 * g3.b) * (0.84 + 0.30 * g2.g) * (1.0 + mow);
    float wr = fenceAt(th);
    float trk = fair * smoothstep(wr - 15.6, wr - 14.9, r);
    alb = mix(grass, vec3(0.16, 0.082, 0.046) * (0.8 + 0.4 * g3.b), trk);
    if (!inC) {
      // the foul lines past the canvas, out to the wall
      float dl = min(abs(xz.x - xz.y), abs(xz.x + xz.y)) * 0.7071; float fw = fwidth(dl) + 0.01;
      alb = mix(alb, vec3(0.78), (1.0 - smoothstep(0.14 - fw, 0.14 + fw, dl)) * step(0.0, xz.y) * step(r, wr - 0.3));
    }
    // the canvas is premultiplied: where it's clear, the grass shows
    alb = alb * (1.0 - dirt.a) + dirt.rgb * (0.82 + 0.36 * g3.r) * (0.92 + 0.16 * g1.b);
    rough = mix(0.86, 0.96, max(dirt.a, trk)); f0s = 0.012;
    // outside the field, under the stands: concrete
    float d1 = (xz.x + xz.y) * 0.7071, d3 = (xz.y - xz.x) * 0.7071;
    bool field = (r < wr + 2.0 && xz.y > -30.0 && min(d1, d3) > -40.0) || r < 58.0;
    if (!field) { alb = vec3(0.060, 0.058, 0.055) * (0.85 + 0.3 * g2.g); dirt.a = 1.0; }
    N = normalize(vec3((g1.r - 0.5) * 0.18 * (1.0 - dirt.a) + (g3.b - 0.5) * 0.12, 1.0, (g1.g - 0.5) * 0.12));
  } else {
    if (vMat == ${MAT.CLOTH}) { rough = 0.9; wrap = 0.25; }
    else if (vMat == ${MAT.SKIN}) { rough = 0.48; wrap = 0.45; f0s = 0.028; }
    else if (vMat == ${MAT.LEATHER}) { rough = 0.42; f0s = 0.04; }
    else if (vMat == ${MAT.GLOSS}) { rough = 0.1; f0s = 0.05; }
    else if (vMat == ${MAT.SATIN}) { rough = 0.32; }
    else if (vMat == ${MAT.METAL}) { rough = 0.38; metal = 1.0; }
    else if (vMat == ${MAT.CONCRETE}) { rough = 0.9; }
    else if (vMat == ${MAT.PAD}) { rough = 0.62; }
    else if (vMat == ${MAT.PLATE}) { rough = 0.5; }
    else if (vMat == ${MAT.MATTE}) { rough = 0.92; }
    // what's near the ground sees less of the sky
    ao = mix(0.62, 1.0, smoothstep(0.0, 1.6, vPos.y));
  }
  vec3 f0 = mix(vec3(f0s), alb, metal);
  vec3 dif = alb * (1.0 - metal);
  float a = max(rough * rough, 0.003);
  float NoV = max(dot(N, V), 1e-3);
  vec3 col = dif * mix(uSkyDn, uSkyUp, N.y * 0.5 + 0.5) * ao;
  vec3 R = reflect(-V, N);
  vec3 env = mix(uSkyDn * 1.4, uSkyUp * 2.2, clamp(R.y * 0.6 + 0.5, 0.0, 1.0));
  vec3 Fv = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - NoV, 5.0);
  col += env * Fv * ao * (1.0 - rough * 0.6);
  for (int i = 0; i < 6; i++) {
    vec3 Lv = uLPos[i] - vPos; float d = length(Lv); vec3 L = Lv / d;
    float NoL = dot(N, L);
    float wd = max((NoL + wrap) / (1.0 + wrap), 0.0), nl = max(NoL, 0.0);
    vec3 H = normalize(L + V); float NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
    vec3 F = f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
    vec3 spec = ggxD(NoH, a) * visSG(NoV, nl, a) * F;
    // the four towers that cast throw this point into shadow where a caster stands between
    float sh = (uLSh[i] >= 0 && uLSh[i] < uSpotN) ? spotShadow(uLSh[i], vPos + N * 0.04) : 1.0;
    vec3 rad = uLCol[i] * spotOf(i, L, 0.05) * mix(sh, 1.0, 0.08) * exp(-max(d - 700.0, 0.0) / 240.0);
    col += (dif / PI * wd * (vMat == ${MAT.GROUND} ? 0.45 + 0.55 * ao : 1.0) + spec * nl) * rad;
    if (vMat == ${MAT.SKIN}) col += alb * vec3(0.10, 0.025, 0.01) * max(wd - nl, 0.0) * rad;
  }
  // cloth has a sheen at grazing angles
  if (vMat == ${MAT.CLOTH}) col += dif * pow(1.0 - NoV, 4.0) * 0.05 * uSkyUp;
  o = vec4(airOf(col, vPos), uAlpha * tex.a);
}`;

const CROWD_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec3 aNrm; layout(location = 2) in float aPart;
layout(location = 3) in vec4 iA; layout(location = 4) in vec4 iB; layout(location = 5) in vec3 iC;
uniform mat4 uVP;
out vec3 vPos; out vec3 vN; out vec3 vAlb;
void main() {
  float c = cos(iA.w), s = sin(iA.w); vec3 p = aPos * iB.w;
  vec3 w = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + iA.xyz;
  vN = vec3(c * aNrm.x + s * aNrm.z, aNrm.y, -s * aNrm.x + c * aNrm.z);
  float h = fract(sin(dot(iA.xz, vec2(12.99, 78.23))) * 43758.5);
  vec3 pants = mix(vec3(0.03, 0.04, 0.07), vec3(0.12, 0.10, 0.07), h);
  vAlb = aPart < 0.5 ? iC : (aPart < 1.5 ? iB.rgb : (aPart < 2.5 ? pants : (aPart < 3.5 ? vec3(0.02, 0.016, 0.012) + 0.05 * h : vec3(0.82, 0.62, 0.16))));
  vPos = w; gl_Position = uVP * vec4(w, 1.0);
}`;
const CROWD_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vN; in vec3 vAlb;
out vec4 o;
${LIGHTS_GLSL}
void main() {
  vec3 N = normalize(vN);
  vec3 col = vAlb * mix(uSkyDn, uSkyUp, N.y * 0.5 + 0.5) * 0.5;
  for (int i = 0; i < 6; i++) { vec3 L = normalize(uLPos[i] - vPos); col += vAlb / PI * max(dot(N, L) * 0.8 + 0.2, 0.0) * uLCol[i] * spotOf(i, L, 0.04) * 0.55; }
  o = vec4(airOf(col, vPos), 1.0);
}`;

// A full-screen triangle with no vertex buffer, as hdr.js draws its passes.
const FULL_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
// The night sky: horizon to zenith, the city's glow low down, and a few stars.
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform mat4 uInvVP; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGlow; uniform float uStars;
${LIGHTS_GLSL}
void main() {
  vec4 p = uInvVP * vec4(vUV * 2.0 - 1.0, 1.0, 1.0); vec3 rd = normalize(p.xyz / p.w - uEye);
  float el = rd.y;
  vec3 col = mix(uHor, uZen, smoothstep(-0.02, 0.55, el)) + uGlow * exp(-max(el, 0.0) * 12.0);
  vec3 q = floor(rd * 520.0); float h = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  col += vec3(step(0.9982, h)) * 0.06 * smoothstep(0.05, 0.35, el) * uStars;
  // the sky is a long way off through the same air: the haze at the horizon, the towers' glow
  o = vec4(airOf(col, uEye + rd * 4000.0), 1.0);
}`;
// The last pass: the bloom added in linear light, the filmic curve, and the encode.
const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uScene; uniform sampler2D uB0; uniform sampler2D uB1;
uniform float uBloom; uniform float uExp;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 oetf(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 c = texture(uScene, vUV).rgb + (texture(uB0, vUV).rgb + texture(uB1, vUV).rgb) * uBloom;
  o = vec4(oetf(aces(max(c, 0.0) * uExp)), 1.0);
}`;

for (const [vs, fs] of [[LIT_VS, LIT_FS], [CROWD_VS, CROWD_FS], [FULL_VS, SKY_FS], [FULL_VS, FINAL_FS]]) declareProgram(vs, fs);

// The night: the sky's colours, its ambient, how hard the towers burn, and the air: a haze that
// thins over 160 ft of height, and how much of the towers' light it scatters.
const NIGHT = {
  up: [0.006, 0.008, 0.016], dn: [0.024, 0.032, 0.017], zen: [0.0018, 0.0024, 0.0065], hor: [0.005, 0.006, 0.009],
  glow: [0.010, 0.008, 0.006], towers: 3.6,
  fog: [0.004, 0.0045, 0.0055], fogDens: 0.00022, fogH: 160, shaft: 1.0, shaftReach: 260,
};

// The quality rungs the view's governor steps through, cheapest last: the lens's taps, the
// occlusion, then the resolution.
export const BALLPARK_RUNGS = [
  { dpr: 2, dof: 28, ao: true }, { dpr: 2, dof: 12, ao: true }, { dpr: 1.5, dof: 12, ao: false }, { dpr: 1.25, dof: 0, ao: false }, { dpr: 1, dof: 0, ao: false },
];

// ── textures, painted on canvases ───────────────────────────────────────────
// Value noise at several scales into the channels: fine blades in R, the macro mottle in G,
// pure grain in B. Tiled, so the field samples it at three scales without a seam.
function noiseCanvas(doc, n, seed, f) {
  const c = doc.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data;
  let s = seed >>> 0;
  const r = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lattice = (k) => { const a = new Float32Array(k * k); for (let i = 0; i < a.length; i++) a[i] = r(); return a; };
  const sample = (a, k, u, v) => {
    const fx = u * k, fy = v * k, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const x0 = ix % k, x1 = (ix + 1) % k, y0 = (iy % k) * k, y1 = ((iy + 1) % k) * k;
    return (a[y0 + x0] * (1 - sx) + a[y0 + x1] * sx) * (1 - sy) + (a[y1 + x0] * (1 - sx) + a[y1 + x1] * sx) * sy;
  };
  const g8 = lattice(8), g16 = lattice(16), g32 = lattice(32), g64 = lattice(64);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n, fine = r();
    const blade = 0.55 * fine + 0.25 * sample(g64, 64, u, v) + 0.2 * sample(g32, 32, u, v);
    const macro = 0.5 * sample(g8, 8, u, v) + 0.3 * sample(g16, 16, u, v) + 0.2 * sample(g32, 32, u, v);
    const out = f ? f(fine, macro) : [blade, macro, fine], k = (y * n + x) * 4;
    d[k] = out[0] * 255; d[k + 1] = out[1] * 255; d[k + 2] = out[2] * 255; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
function canvasOf(doc, w, h, paint) { const c = doc.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); return c; }
// The wall padding: dark green, a lighter top edge, a yellow line along the top.
const padCanvas = (doc) => canvasOf(doc, 512, 256, (g) => {
  g.fillStyle = '#163d2f'; g.fillRect(0, 0, 512, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, 'rgba(255,255,255,0.06)'); grd.addColorStop(1, 'rgba(0,0,0,0.12)'); g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, 4, 256); g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(4, 0, 2, 256);
  g.fillStyle = '#e8c73a'; g.fillRect(0, 0, 512, 10);
});
// Four seats to a tile, blue on grey.
const seatCanvas = (doc) => canvasOf(doc, 256, 64, (g) => {
  g.fillStyle = '#3d4650'; g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 4; i++) { g.fillStyle = '#2d5f7d'; g.fillRect(i * 64 + 6, 8, 52, 40); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(i * 64 + 6, 44, 52, 6); }
});
// The ads round the front of the lower bowl behind the plate, four to a repeat.
const adsCanvas = (doc, ads) => canvasOf(doc, 2048, 128, (g) => {
  const list = (ads && ads.length ? ads : ['', '', '', '']).slice(0, 4);
  while (list.length < 4) list.push(list[list.length % Math.max(1, ads?.length || 1)] || '');
  const inks = ['#f5d24a', '#ffffff', '#9fd8e0', '#f5d24a'];
  list.forEach((t, i) => {
    g.fillStyle = i % 2 ? '#22355e' : '#1b2a4b'; g.fillRect(i * 512, 0, 512, 128);
    if (!t) return;
    g.fillStyle = inks[i]; g.font = `italic bold 70px ${FACE}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(i * 512 + 256, 66); g.scale(0.9, 1); g.fillText(String(t).toUpperCase(), 0, 0, 470); g.restore();
  });
});
// The wall's distances, a cell each, white on clear.
const numsCanvas = (doc, texts) => canvasOf(doc, 1024, 128, (g) => {
  g.clearRect(0, 0, 1024, 128);
  g.font = `bold 104px ${FACE}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f2f0e6';
  texts.forEach((t, i) => g.fillText(t, i * 256 + 128, 68, 240));
});
// The backstop's mesh.
const netCanvas = (doc) => canvasOf(doc, 128, 128, (g) => {
  g.clearRect(0, 0, 128, 128); g.strokeStyle = 'rgba(30,30,30,1)'; g.lineWidth = 3;
  for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
});

// The painted canvases are the same for every park and every mount: made once a document.
const _canvases = new WeakMap();
function sharedCanvases(doc) {
  let c = _canvases.get(doc);
  if (!c) {
    c = {
      grass: noiseCanvas(doc, 512, 3),
      concrete: noiseCanvas(doc, 256, 12, (fine, macro) => { const b = 0.46 + 0.10 * macro + 0.06 * fine; return [b, b * 0.98, b * 0.95]; }),
      dirt: paintInfield(doc), pad: padCanvas(doc), seat: seatCanvas(doc), net: netCanvas(doc),
    };
    _canvases.set(doc, c);
  }
  return c;
}

// The park's geometry for a venue: built once a venue.
const _parks = new Map();
function parkFor(venue) {
  const key = JSON.stringify(venue || null);
  let p = _parks.get(key);
  if (!p) { p = buildPark(venue); _parks.set(key, p); if (_parks.size > 4) _parks.delete(_parks.keys().next().value); }
  return p;
}

export function createBallparkRenderer(canvas, opts = {}) {
  const doc = canvas.ownerDocument;
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: true,
      powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  } catch { gl = null; }
  if (!gl) return null;
  try { return build(); } catch (err) { console.warn('[ballpark] GLASS 2 park unavailable, drawing in 2-D:', err && err.message); return null; }

  function build() {
    prewarmPrograms(gl);
    const hdr = createHDRLayer(gl);
    if (!hdr) return null;
    // ⚠ THE SHADOW MAPS ARE NOT OPTIONAL. The lit shader declares four shadow samplers, and WebGL2
    // refuses a draw whose shadow sampler reads a texture with no compare mode, or shares a unit
    // with an ordinary sampler. So the maps always exist (a 1×1 set if a full one won't allocate)
    // and are always bound, and `uSpotN` says how many hold anything this frame.
    const shadows = createSpotShadows(gl) || createSpotShadows(gl, { size: 1 });
    if (!shadows) return null;
    const ssao = createDepthSSAO(gl);
    const bc = createBroadcastPass(gl);
    const prog = (vs, fs) => {
      let p = takeWarm(gl, vs, fs);
      if (!p) {
        p = gl.createProgram();
        for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
          const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('ballpark shader: ' + gl.getShaderInfoLog(sh));
          gl.attachShader(p, sh); gl.deleteShader(sh);
        }
        gl.linkProgram(p);
      }
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('ballpark link: ' + gl.getProgramInfoLog(p));
      const u = {};
      return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) };
    };
    const LIT = prog(LIT_VS, LIT_FS), CROWD = prog(CROWD_VS, CROWD_FS), SKY = prog(FULL_VS, SKY_FS), FINAL = prog(FULL_VS, FINAL_FS);

    // ── textures ──────────────────────────────────────────────────────────────
    const T2 = gl.TEXTURE_2D;
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const maxAniso = aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    // A colour texture is sRGB, so sampling it gives linear light; a data texture isn't.
    function texture(src, { srgb = true, repeat = true, premul = false, af = 8 } = {}) {
      const t = gl.createTexture();
      gl.bindTexture(T2, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);
      gl.texImage2D(T2, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(T2);
      gl.texParameteri(T2, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(T2, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(T2, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(T2, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      if (aniso) gl.texParameterf(T2, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(af, maxAniso));
      return t;
    }
    const park = parkFor(opts.venue);
    const shared = sharedCanvases(doc);
    const TEX = {
      grass: texture(shared.grass, { srgb: false }),
      dirt: texture(shared.dirt, { repeat: false, premul: true, af: 16 }),
      pad: texture(shared.pad), concrete: texture(shared.concrete), seat: texture(shared.seat), net: texture(shared.net),
      ads: texture(adsCanvas(doc, opts.ads)), nums: texture(numsCanvas(doc, park.numbers), { repeat: false }),
    };
    // the scoreboard's lamps, one byte each
    const boardTex = gl.createTexture();
    gl.bindTexture(T2, boardTex);
    gl.texParameteri(T2, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(T2, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(T2, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(T2, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    function setBoard(state) {
      gl.bindTexture(T2, boardTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(T2, 0, gl.R8, BOARD_W, BOARD_H, 0, gl.RED, gl.UNSIGNED_BYTE, boardLamps(state));
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    }
    setBoard({});

    // ── geometry, once ────────────────────────────────────────────────────────
    const LIT_ATTRS = [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 3, 32], [4, 1, 44]];
    const upload = (b) => {
      const vao = gl.createVertexArray(), st = makeVertexStream(gl, vao, STRIDE, LIT_ATTRS);
      st.write(b.data, b.n * STRIDE);
      return { vao, n: b.n, st };
    };
    const opaque = [...park.opaque].map(([key, b]) => ({ key, ...upload(b) }));
    const translucent = [...park.translucent].map(([key, b]) => ({ key, ...upload(b) }));
    const crowd = [];
    for (const kind of ['sit', 'stand', 'cheer']) {
      const inst = park.crowd[kind];
      if (!inst.length) continue;
      const mesh = crowdMesh(kind, { far: opts.crowd !== 'near', towels: !!opts.towels });
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const mb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mb); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
      const VS = CROWD_VERTEX * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VS, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VS, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, VS, 24);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
      const IS = CROWD_STRIDE * 4;
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, IS, 0); gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, IS, 16); gl.vertexAttribDivisor(4, 1);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 3, gl.FLOAT, false, IS, 32); gl.vertexAttribDivisor(5, 1);
      gl.bindVertexArray(null);
      crowd.push({ vao, n: mesh.length / CROWD_VERTEX, count: inst.length / CROWD_STRIDE, buffers: [mb, ib] });
    }
    const emptyVao = gl.createVertexArray();

    // ── the lights ────────────────────────────────────────────────────────────
    // Each tower burns in proportion to its working lamps; the two behind the plate are
    // smaller banks.
    const LPos = new Float32Array(18), LCol = new Float32Array(18), LDir = new Float32Array(18);
    park.field.towers.slice(0, 6).forEach((T, i) => {
      const k = NIGHT.towers * (T.frac / 0.62) * (T.base[2] < 0 ? 0.7 : 1);
      LPos.set(T.lamp, i * 3); LCol.set([k, k * 0.965, k * 0.9], i * 3); LDir.set(T.dir, i * 3);
    });
    const fence = park.field.fence;
    // the four towers on the field side cast; the two behind the plate don't
    const LSh = new Int32Array(6).fill(-1);
    { let k = 0; park.field.towers.slice(0, 6).forEach((T, i) => { if (T.base[2] >= 0 && k < shadows.count) LSh[i] = k++; }); }
    const casting = park.field.towers.filter((T, i) => LSh[i] >= 0);

    // The depth the frame was drawn with, resolved into a texture the lens and the occlusion read.
    // A blit from the multisampled target costs no second pass over the park.
    let depth = null;
    function depthTarget(w, h) {
      if (depth && depth.w === w && depth.h === h) return depth;
      if (depth) { gl.deleteFramebuffer(depth.fbo); gl.deleteTexture(depth.tex); depth = null; }
      const tex = gl.createTexture();
      gl.bindTexture(T2, tex);
      gl.texStorage2D(T2, 1, gl.DEPTH_COMPONENT24, w, h);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(T2, k, v);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, T2, tex, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); return null; }
      return (depth = { tex, fbo, w, h });
    }

    let lost = false;
    canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); lost = true; api.lost = true; });
    const stats = { tris: 0, draws: 0, ms: 0 };

    function lights(P, eye) {
      gl.uniform3fv(P.u('uLPos'), LPos); gl.uniform3fv(P.u('uLCol'), LCol); gl.uniform3fv(P.u('uLDir'), LDir);
      gl.uniform3fv(P.u('uEye'), eye); gl.uniform3fv(P.u('uSkyUp'), NIGHT.up); gl.uniform3fv(P.u('uSkyDn'), NIGHT.dn);
      const q = api.quality;
      gl.uniform3fv(P.u('uFogCol'), NIGHT.fog); gl.uniform1f(P.u('uFogDens'), q.fog ? NIGHT.fogDens : 0); gl.uniform1f(P.u('uFogH'), NIGHT.fogH);
      gl.uniform1f(P.u('uShaft'), q.fog ? NIGHT.shaft : 0); gl.uniform1f(P.u('uShaftReach'), NIGHT.shaftReach);
    }

    // ── a frame ───────────────────────────────────────────────────────────────
    function render(shot) {
      if (lost) return false;
      const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
      const w = canvas.width, h = canvas.height;
      if (!(w > 0 && h > 0)) return false;
      const M = shotMatrices(shot, w / h), q = api.quality;
      let tris = 0, draws = 0;

      // 1. the towers' shadows, of whatever casts
      let spotN = 0;
      const casters = api.casters;
      if (q.shadows && casters.length) {
        const [focus, radius] = M.shadow || [[0, 0, 60], 80];
        spotN = shadows.render(casting.map((T) => ({ lamp: T.lamp, focus, radius })), () => {
          for (const c of casters) { gl.bindVertexArray(c.vao); gl.drawArrays(gl.TRIANGLES, 0, c.n); }
          gl.bindVertexArray(null);
        });
      }

      if (!hdr.bind(w, h)) return false;
      gl.clearColor(0, 0, 0, 1); gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);

      // the sky, behind everything
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(SKY.p);
      lights(SKY, M.eye);
      gl.uniformMatrix4fv(SKY.u('uInvVP'), false, inv4(M.viewProj));
      gl.uniform3fv(SKY.u('uZen'), NIGHT.zen); gl.uniform3fv(SKY.u('uHor'), NIGHT.hor); gl.uniform3fv(SKY.u('uGlow'), NIGHT.glow); gl.uniform1f(SKY.u('uStars'), 1);
      gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); draws++;

      // the park
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
      gl.useProgram(LIT.p);
      lights(LIT, M.eye);
      gl.uniformMatrix4fv(LIT.u('uVP'), false, M.viewProj);
      gl.uniform1i(LIT.u('uTex'), 0); gl.uniform1i(LIT.u('uDirt'), 1); gl.uniform1i(LIT.u('uGrass'), 2); gl.uniform1i(LIT.u('uBoard'), 3);
      gl.uniform3f(LIT.u('uFence'), fence.line, fence.centre, fence.curve);
      gl.uniform2f(LIT.u('uBoardRes'), BOARD_W, BOARD_H); gl.uniform3f(LIT.u('uBoardOn'), 6.0, 3.0, 0.7);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(T2, TEX.dirt);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(T2, TEX.grass);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(T2, boardTex);
      shadows.bind(LIT.u, 4);
      gl.uniform1iv(LIT.u('uLSh'), LSh); gl.uniform1i(LIT.u('uSpotN'), spotN);
      const drawSet = (list, alpha) => {
        for (const d of list) {
          const t = TEX[d.key];
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(T2, t || null);
          gl.uniform1i(LIT.u('uTextured'), t ? 1 : 0);
          gl.uniform1f(LIT.u('uAlphaTest'), d.key === 'nums' ? 0.5 : -1);
          gl.uniform1f(LIT.u('uAlpha'), alpha);
          gl.uniform1f(LIT.u('uEmis'), 1);
          gl.bindVertexArray(d.vao); gl.drawArrays(gl.TRIANGLES, 0, d.n);
          tris += d.n / 3; draws++;
        }
      };
      drawSet(opaque, 1);

      // the crowd
      if (crowd.length) {
        gl.useProgram(CROWD.p);
        lights(CROWD, M.eye);
        gl.uniformMatrix4fv(CROWD.u('uVP'), false, M.viewProj);
        for (const d of crowd) { gl.bindVertexArray(d.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, d.n, d.count); tris += d.n / 3 * d.count; draws++; }
      }

      // the backstop net, see-through, over the rest
      gl.useProgram(LIT.p);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      drawSet(translucent, 0.32);
      gl.depthMask(true); gl.disable(gl.BLEND);
      gl.bindVertexArray(null);

      // 3. the depth, out of the multisampled target before it's resolved
      const D = (q.ao || q.dof > 0) ? depthTarget(w, h) : null;
      if (D) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr.drawFbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, D.fbo);
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      }

      // resolve, and gather the bloom off the lamps
      const res = hdr.resolve({ bloom: 1, threshold: 1.0, knee: 0.5, linear: 0 });
      if (!res) return false;

      // 4. the occlusion, at half size
      const ao = D && q.ao && ssao ? ssao.render(D.tex, Math.max(1, w >> 1), Math.max(1, h >> 1), ssaoConstants(M.proj), { radius: 2.0, bias: 0.05, slope: 3 }) : null;

      // 5. the lens, the curve and the grade onto the canvas
      if (bc && bc.render({
        scene: res.scene, bloom: res.bloom, depth: D ? D.tex : null, ao, w, h, near: M.near, far: M.far,
        focus: Math.hypot(M.at[0] - M.eye[0], M.at[1] - M.eye[1], M.at[2] - M.eye[2]), dof: M.dof || 0, taps: q.dof,
        exposure: q.exposure, bloomK: q.bloom, aoK: q.aoK ?? 0.75, grade: q.grade, tube: q.tube, seed: 3.7,
      })) {
        stats.tris = Math.round(tris); stats.draws = draws + 2;
        stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
        return true;
      }
      // no broadcast pass: the plain curve
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(FINAL.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(T2, res.scene); gl.uniform1i(FINAL.u('uScene'), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(T2, res.bloom ? res.bloom[0] : res.scene); gl.uniform1i(FINAL.u('uB0'), 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(T2, res.bloom ? res.bloom[1] : res.scene); gl.uniform1i(FINAL.u('uB1'), 2);
      gl.uniform1f(FINAL.u('uBloom'), res.bloom ? api.quality.bloom : 0);
      gl.uniform1f(FINAL.u('uExp'), api.quality.exposure);
      gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); draws++;
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.DEPTH_TEST);
      stats.tris = Math.round(tris); stats.draws = draws;
      stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      return true;
    }

    function dispose() {
      try {
        shadows.dispose(); ssao?.dispose(); bc?.dispose();
        if (depth) { gl.deleteFramebuffer(depth.fbo); gl.deleteTexture(depth.tex); depth = null; }
        for (const t of Object.values(TEX)) gl.deleteTexture(t);
        gl.deleteTexture(boardTex);
        for (const d of [...opaque, ...translucent]) { gl.deleteVertexArray(d.vao); gl.deleteBuffer(d.st.buf); }
        for (const d of crowd) { gl.deleteVertexArray(d.vao); for (const b of d.buffers) gl.deleteBuffer(b); }
        hdr.dispose();
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch { /* a lost context has nothing left to free */ }
      lost = true; api.lost = true;
    }

    const api = {
      kind: 'gl', lost: false, rungs: BALLPARK_RUNGS,
      // grade: 'arcade', 'broadcast' or 'none'; tube: the tube glass; dof: the lens's taps (0 off)
      quality: { dpr: 2, bloom: 0.18, exposure: 1.0, grade: opts.grade || 'arcade', tube: !!opts.tube, ao: true, dof: 28, shadows: true, fog: true },
      // what casts the towers' shadows: [{ vao, n }] with positions at location 0 (the players, Phase 1c)
      casters: [],
      render, setBoard, dispose, stats,
      get park() { return park; },
    };
    return api;
  }
}
