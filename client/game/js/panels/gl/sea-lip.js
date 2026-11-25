// THE CURLING LIP (RENDER_TUNE.glSeaLip; docs/reference/glass-notes.md "The curling lip").
//
// The sea is a height field, and a height field can't overturn: the best water.js can do is pitch a
// breaking crest forward. This draws the part it can't: a sheet thrown forward off the crest and
// curling down onto the face, along every breaking crest in the surf zone near the eye.
//
// How it finds the crests without searching for them: a static grid of small curl pieces round the
// camera, one per cell. Each piece works out the swell's phase at its cell, and only the piece whose
// cell the lip line crosses stays; it slides along the wavevector onto the line, so neighbouring
// pieces join into one ribbon down the crest. Everything else collapses to nothing.
//
// Its height is the long swell, the wind sea and the breaker's lean at the crest, the same terms
// water.js displaces by; the chop and the wakes are left out (a few centimetres), so the lip's root
// sits a hair inside the water and never floats above it.
import { SEA_GLSL } from './sea-glsl.js';
import { layerProgram } from './programs.js';
import { linearOut, applyLinOut } from './colour.js';
import { SURF_DEPTH_Q, SEA_K } from '../../../../shared/sea-swell.js';
import { BREAK_GLSL, BREAK_LAMBDA_T, BREAK_SIGMA } from '../../../../shared/sea-breakers.js';

const LIP_R = 18 / SEA_K;          // how far from the eye the lip is drawn, in tiles
const STEP = 0.3 / SEA_K;          // grid spacing, in tiles
const NV = 7;                      // rows round the curl
const K_PH = 0.24557 * SEA_K;      // the long swell's phase change per world tile along its wavevector
const LIP_PH = -0.2;
const BREAK_FAR = 16;              // tiles; the breakers' upload radius, where their curl fades out               // where the lip sits on the swell, in seaSurfPhase's radians
const FINE_R = 6 / SEA_K;          // water.js's PATCH_FINE_R: where the mesh stops sliding a breaker's crest forward

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCell;   // this piece's cell, offset from the snapped camera point
layout(location = 1) in vec2 aSV;     // s across the crest (-0.5..0.5), v round the curl (0..1)
uniform mat4  uViewProj;
uniform vec2  uSnap;
uniform float uT, uRoll, uWind, uState, uSurf, uShelter, uShoal, uRefract, uLip, uLipSize, uFace, uR, uStep;
uniform vec2  uSeaRot;
uniform sampler2D uLut0, uLut1, uDepthT;
uniform int   uMh;
out float vV;
out float vK;
out vec2  vW;
out vec3  vN;

${SEA_GLSL}

float lutA(sampler2D s, vec2 p, int ch) {
  vec2 f = vec2(uR) + p;
  ivec2 i = ivec2(floor(f));
  vec2 fr = f - floor(f);
  ivec2 m = ivec2(uMh - 1);
  vec4 a = texelFetch(s, clamp(i, ivec2(0), m), 0), b = texelFetch(s, clamp(i + ivec2(1, 0), ivec2(0), m), 0);
  vec4 c = texelFetch(s, clamp(i + ivec2(0, 1), ivec2(0), m), 0), d = texelFetch(s, clamp(i + ivec2(1), ivec2(0), m), 0);
  vec4 v = mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
  return ch == 0 ? v.r : v.a;
}
float waterAt(vec2 p)   { return lutA(uLut0, p, 3); }
float shelterAt(vec2 p) { return lutA(uLut1, p, 3); }
float depthAt(vec2 p)   { return lutA(uDepthT, p, 0) * ${(255 / SURF_DEPTH_Q).toFixed(4)}; }

// The sea at a world point, as water.js's vertex shader works it out: the warped sample point, the
// surf zone, the swell's amplitude there and its phase.
struct Sea { vec2 swR; float zone; float A; float fp; float gate; float shel; float deep; };
Sea seaAt(vec2 w, vec2 kdir) {
  Sea o;
  float water = waterAt(w);
  o.deep = clamp((water - 0.5) * 2.0, 0.0, 1.0);
  vec2 gW = vec2(waterAt(w + vec2(1.0, 0.0)) - waterAt(w - vec2(1.0, 0.0)),
                 waterAt(w + vec2(0.0, 1.0)) - waterAt(w - vec2(0.0, 1.0)));
  vec2 gH = vec2(depthAt(w + vec2(1.0, 0.0)) - depthAt(w - vec2(1.0, 0.0)),
                 depthAt(w + vec2(0.0, 1.0)) - depthAt(w - vec2(0.0, 1.0)));
  float hM = depthAt(w);
  vec2 sw = seaRefract(seaShoal(w, water, gW, uShoal), hM, gH, kdir, uRefract);
  o.swR = seaFrame(sw, uSeaRot);
  o.shel = mix(1.0, shelterAt(w), uShelter);
  float H0 = seaH0(uRoll, uWind) * o.shel;
  o.gate = seaShoalGain(o.deep, hM, H0, uSurf);
  o.zone = seaSurfZone(hM, H0) * smoothstep(0.0, 0.5, o.deep) * uSurf;
  o.A = (uRoll + uWind) * o.gate * o.shel;
  o.fp = seaSurfPhase(o.swR, uT);
  return o;
}

void main() {
  vec2 kdir = normalize(seaUnturn(vec2(0.8529, 0.5224), uSeaRot));
  vec2 w = uSnap + aCell;
  Sea a = seaAt(w, kdir);
  // Slide onto the lip line along the wavevector; keep only the piece whose cell it crosses.
  float dph = LIP - a.fp;
  dph = mod(dph + 3.14159265, 6.2831853) - 3.14159265;
  float shift = dph / ${K_PH.toFixed(5)};
  float mine = step(abs(shift), uStep * 0.75);
  vec2 c = w + kdir * shift;
  Sea s = seaAt(c, kdir);
  float broken = smoothstep(0.7, 1.0, s.zone);
  float seaK = clamp(uState * 1.4 + 0.25, 0.0, 1.0);
  float k = mine * broken * seaK * uLip * smoothstep(0.004, 0.02, s.A);
  // Gone: every corner on one point outside the clip volume, so the piece has no area.
  if (k < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vV = 0.0; vK = 0.0; vW = c; vN = vec3(0.0, 0.0, 1.0); return; }

  float ph = seaPh(s.swR, uT);
  float hc = seaRoll(s.swR, uT, uRoll * s.gate * s.shel, 1.0) + seaWind(s.swR, uT, ph, uWind * s.gate * s.shel, 1.0)
           + seaSurfLean(s.swR, uT, uRoll * s.gate * s.shel) * s.zone * smoothstep(0.0, 0.5, s.deep) * uSurf
           + seaSurfFace(s.swR, uT, uRoll * s.gate * s.shel, s.zone * smoothstep(0.0, 0.5, s.deep) * uSurf, uFace);
  // The wave runs toward -k, so forward (shoreward) is -kdir; the crest runs across it.
  vec2 fwd = -kdir, across = vec2(-kdir.y, kdir.x);
  // The curl: a sheet leaving the crest going forward and a little up, then turning down onto the
  // face. Its radius is set by the wave's height, and it grows in as the wave breaks (k).
  // Drawn larger than life (uLipSize, the tune value): a true 2 m lip is a few pixels from most seats.
  float R = s.A * 1.15 * uLipSize * (0.55 + 0.45 * k);
  float ang = aSV.y * 3.14159265 * (0.55 + 0.55 * k);
  float lift = 0.25 * R * sin(aSV.y * 3.14159265);
  vec2 xy = c + fwd * (R * sin(ang)) + across * (aSV.x * uStep * 1.35);
  float z = hc - s.A * 0.08 + R * 0.35 + lift - R * (1.0 - cos(ang));
  vV = aSV.y;
  vK = k;
  vW = xy;
  vN = normalize(vec3(fwd * sin(ang), cos(ang)));
  gl_Position = uViewProj * vec4(xy, z, 1.0);
}`;

// ── THE OPEN SEA'S BREAKERS (client/shared/sea-breakers.js) ─────────────────────────────────────
//
// Out at sea there's no swell phase to search for: the breakers arrive as a list, so each one is an
// instance, a ribbon along its crest NA pieces long and NV rows round the curl. It roots on the crest
// where water.js put it, lift and forward slide included (seaBreakers, the same function), and its
// life is the breaker's: it rises as the face steepens, throws forward and over as the lip goes, then
// falls into the white water it leaves. A plunger throws a full barrel; a spiller only tips forward.
// The ends taper so a ribbon never ends in a cut.
const NA = 16;
const VERT_B = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aSV;     // s along the crest (-0.5..0.5), v round the curl (0..1)
uniform mat4  uViewProj;
uniform float uT, uRoll, uWind, uSpread, uR, uFineR, uFar;
uniform vec2  uSeaRot;
uniform vec3  uEye;
uniform sampler2D uLut0;
uniform int   uMh;
out float vV;
out float vK;
out vec2  vW;
out vec3  vN;

${SEA_GLSL}
${BREAK_GLSL}

float waterAt(vec2 p) {
  vec2 f = vec2(uR) + p;
  ivec2 i = ivec2(floor(f));
  vec2 fr = f - floor(f);
  ivec2 m = ivec2(uMh - 1);
  float a = texelFetch(uLut0, clamp(i, ivec2(0), m), 0).a, b = texelFetch(uLut0, clamp(i + ivec2(1, 0), ivec2(0), m), 0).a;
  float c = texelFetch(uLut0, clamp(i + ivec2(0, 1), ivec2(0), m), 0).a, d = texelFetch(uLut0, clamp(i + ivec2(1), ivec2(0), m), 0).a;
  return mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
}

void main() {
  vec4 P = uBrkP[gl_InstanceID], S = uBrkS[gl_InstanceID];
  vec2 d = P.zw, al = vec2(-d.y, d.x);
  float ph = S.z, pl = S.w;
  float grow = smoothstep(0.22, 0.5, ph);
  float fall = smoothstep(0.55, 0.85, ph);
  float vis = grow * (1.0 - smoothstep(0.72, 0.92, ph));
  float ends = 1.0 - smoothstep(0.55, 1.0, abs(aSV.x) * 2.0);
  vec2 c = P.xy + al * (aSV.x * 2.0 * S.x * 0.9) + d * ${(0.25 * BREAK_SIGMA * BREAK_LAMBDA_T).toFixed(4)};
  float deep = clamp((waterAt(c) - 0.5) * 2.0, 0.0, 1.0);
  float dist = length(c - uEye.xy);
  float k = vis * ends * smoothstep(0.5, 1.0, deep) * (1.0 - smoothstep(uFar * 0.7, uFar, dist));
  if (k < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vV = 0.0; vK = 0.0; vW = c; vN = vec3(0.0, 0.0, 1.0); return; }
  // The water under the crest, as water.js displaces it: roll, wind sea and the breakers themselves.
  vec2 cr = seaFrame(c, uSeaRot);
  float h = seaRoll(cr, uT, uRoll, uSpread) + seaWind(cr, uT, seaPh(cr, uT), uWind, uSpread);
  vec2 sl = vec2(0.0), g = vec2(0.0), jd = d; float J = 1.0;
  seaBreakers(c, 1.0, h, sl, g, J, jd);
  sl *= 1.0 - smoothstep(uFineR * 0.8, uFineR * 1.05, dist);
  vec2 root = c + sl;
  // The curl's radius is the crest's own height, true size: at the surf lip's 2.4x it hung over the
  // crest like a glass hood. A spiller only tips its top over.
  float R = S.y * mix(0.5, 1.0, pl) * (0.45 + 0.55 * grow) * (0.4 + 0.6 * ends);
  float ang = aSV.y * 3.14159265 * mix(0.45, 1.15, pl) * (0.35 + 0.65 * grow) + aSV.y * fall * 0.7;
  vec2 xy = root + d * (R * sin(ang)) + al * (aSV.x * 0.02);
  // Rooted on the crest the mesh drew (h has the breaker's own lift in it), not above it.
  float z = h - S.y * 0.04 + 0.15 * R * sin(aSV.y * 3.14159265) - R * (1.0 - cos(ang));
  z -= fall * R * 0.8 * aSV.y;
  // vV past the root goes white sooner out here: open-sea lips are thin and torn from the start.
  vV = min(1.0, aSV.y * 1.35 + 0.1);
  vK = k;
  vW = xy;
  vN = normalize(vec3(d * sin(ang), cos(ang)));
  gl_Position = uViewProj * vec4(xy, z, 1.0);
}`;

const FRAG = linearOut(`#version 300 es
precision highp float;
in float vV;
in float vK;
in vec2  vW;
in vec3  vN;
uniform vec3  uBody, uHor, uSunDir3, uEye;
uniform float uNm, uHz, uHazeMax, uDepth, uT;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  // Torn at the tip: the throw breaks into strands and drops as it falls.
  float n = hash(floor(vW * 26.0 + vec2(0.0, floor(uT * 12.0))));
  if (vV > 0.55 && n < (vV - 0.55) * 1.8) discard;
  // Green-blue water at the root, lit through where it is thin, going to white as it tears.
  vec3 water = uBody * 1.25 + vec3(0.05, 0.16, 0.14) * (1.0 - vV);
  float sun = max(0.0, dot(normalize(vN), uSunDir3)) * 0.35;
  // Matte white lit by the sun's angle on it and the sky, so the throw has a lit top and a shaded
  // underside rather than glowing evenly.
  vec3 foam = vec3(0.86, 0.9, 0.93) * (0.55 + 0.45 * max(0.0, dot(normalize(vN), uSunDir3)));
  vec3 col = mix(water + sun, foam, smoothstep(0.15, 0.7, vV)) * (0.45 + 0.55 * uNm);
  float dist = length(uEye - vec3(vW, 0.0));
  float p = clamp(uDepth / max(0.02, dist), 0.0, 4.0);
  col = mix(col, uHor, clamp(1.0 - p * uHz, 0.0, uHazeMax));
  float a = vK * (0.92 - 0.25 * vV);
  fragColor = vec4(col * a, a);
}`, 'fragColor');

export function createSeaLip(gl) {
  const prog = layerProgram(gl, VERT.replace('float dph = LIP', `float dph = ${LIP_PH.toFixed(3)}`), FRAG, 'sea-lip');
  const U = (n) => gl.getUniformLocation(prog, n);
  const names = ['uViewProj', 'uSnap', 'uT', 'uRoll', 'uWind', 'uState', 'uSurf', 'uShelter', 'uShoal', 'uRefract', 'uLip', 'uLipSize', 'uFace',
    'uR', 'uStep', 'uSeaRot', 'uLut0', 'uLut1', 'uDepthT', 'uMh', 'uBody', 'uHor', 'uSunDir3', 'uEye', 'uNm', 'uHz',
    'uHazeMax', 'uDepth'];
  const loc = Object.fromEntries(names.map((n) => [n, U(n)]));
  const progB = layerProgram(gl, VERT_B, FRAG, 'sea-lip-breakers');
  const locB = Object.fromEntries(['uViewProj', 'uT', 'uRoll', 'uWind', 'uSpread', 'uR', 'uFineR', 'uFar', 'uSeaRot', 'uEye', 'uLut0', 'uMh',
    'uNBrk', 'uBrkP', 'uBrkS', 'uBody', 'uHor', 'uSunDir3', 'uNm', 'uHz', 'uHazeMax', 'uDepth'].map((n) => [n, gl.getUniformLocation(progB, n)]));
  // The breaker ribbon: NA columns along the crest, NV rows round the curl.
  const svB = [];
  for (let a = 0; a < NA; a++) for (let j = 0; j < NV - 1; j++) {
    const s0 = a / NA - 0.5, s1 = (a + 1) / NA - 0.5, v0 = j / (NV - 1), v1 = (j + 1) / (NV - 1);
    svB.push(s0, v0, s1, v0, s1, v1, s0, v0, s1, v1, s0, v1);
  }
  const pieceB = svB.length / 2;
  const vaoB = gl.createVertexArray();
  gl.bindVertexArray(vaoB);
  const bb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(svB), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.bindVertexArray(null);

  // The open sea's breakers, in the blend and depth state draw() sets up.
  function drawBreakers(vp, s, mh) {
    const bk = s.breakers;
    if (!bk || !bk.n) return 0;
    gl.useProgram(progB); applyLinOut(gl, progB);
    gl.uniformMatrix4fv(locB.uViewProj, false, vp);
    gl.uniform1f(locB.uT, s.t || 0);
    gl.uniform1f(locB.uRoll, s.seaRoll || 0);
    gl.uniform1f(locB.uWind, s.seaWind || 0);
    gl.uniform1f(locB.uSpread, s.seaSpread == null ? 0 : s.seaSpread);
    gl.uniform1f(locB.uR, s.R || 0);
    gl.uniform1f(locB.uFineR, FINE_R);
    gl.uniform1f(locB.uFar, BREAK_FAR);
    const rot = s.seaRot || [1, 0];
    gl.uniform2f(locB.uSeaRot, rot[0], rot[1]);
    gl.uniform3f(locB.uEye, s.ax || 0, s.ay || 0, s.EH == null ? 0.12 : s.EH);
    gl.uniform1i(locB.uLut0, 2);
    gl.uniform1i(locB.uMh, mh | 0);
    gl.uniform1i(locB.uNBrk, bk.n);
    gl.uniform4fv(locB.uBrkP, bk.P); gl.uniform4fv(locB.uBrkS, bk.S);
    const body = s.seaBody || [0.133, 0.243, 0.345], hor = s.hor || [0.3, 0.4, 0.5];
    gl.uniform3f(locB.uBody, body[0], body[1], body[2]);
    gl.uniform3f(locB.uHor, hor[0], hor[1], hor[2]);
    const sd = s.sunDir || [0, 0], se = Math.max(s.sunElev || 0, 0), sc = Math.sqrt(Math.max(0, 1 - se * se));
    gl.uniform3f(locB.uSunDir3, sd[0] * sc, sd[1] * sc, se);
    gl.uniform1f(locB.uNm, s.nm == null ? 1 : s.nm);
    gl.uniform1f(locB.uHz, s.hz || 0);
    gl.uniform1f(locB.uHazeMax, s.hazeMax == null ? 1 : s.hazeMax);
    gl.uniform1f(locB.uDepth, s.depth || 200);
    gl.bindVertexArray(vaoB);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, pieceB, bk.n);
    gl.bindVertexArray(null);
    return (pieceB / 3) * bk.n;
  }

  // The piece: two columns across the crest, NV rows round the curl, as a triangle strip list.
  const sv = [];
  for (let j = 0; j < NV - 1; j++) {
    const v0 = j / (NV - 1), v1 = (j + 1) / (NV - 1);
    sv.push(-0.5, v0, 0.5, v0, 0.5, v1, -0.5, v0, 0.5, v1, -0.5, v1);
  }
  const pieceN = sv.length / 2;
  // The cells, a disc of them round the eye.
  const cells = [];
  const n = Math.ceil(LIP_R / STEP);
  for (let iy = -n; iy <= n; iy++) for (let ix = -n; ix <= n; ix++) {
    if (Math.hypot(ix, iy) * STEP <= LIP_R) cells.push(ix * STEP, iy * STEP);
  }
  const cellN = cells.length / 2;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const bc = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bc);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cells), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.vertexAttribDivisor(0, 1);
  const bs = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bs);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sv), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 8, 0);
  gl.bindVertexArray(null);

  // Drawn straight after the sea, with the sea's textures still on units 2, 5 and 6, and its
  // matrices and colours from the same floor state.
  function draw(vp, s, mh) {
    if (!((s.seaLip || 0) > 0)) return 0;
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const tris = drawBreakers(vp, s, mh);
    if (!((s.seaSurf || 0) > 0)) { gl.depthMask(true); return tris; }
    gl.useProgram(prog); applyLinOut(gl, prog);
    gl.uniformMatrix4fv(loc.uViewProj, false, vp);
    gl.uniform2f(loc.uSnap, Math.round((s.ax || 0) / STEP) * STEP, Math.round((s.ay || 0) / STEP) * STEP);
    gl.uniform1f(loc.uT, s.t || 0);
    gl.uniform1f(loc.uRoll, s.seaRoll || 0);
    gl.uniform1f(loc.uWind, s.seaWind || 0);
    gl.uniform1f(loc.uState, s.seaState || 0);
    gl.uniform1f(loc.uSurf, s.seaSurf || 0);
    gl.uniform1f(loc.uShelter, s.seaShelter || 0);
    gl.uniform1f(loc.uShoal, s.seaShoal || 0);
    gl.uniform1f(loc.uRefract, s.seaRefract || 0);
    gl.uniform1f(loc.uLip, Math.min(1, s.seaLip));
    gl.uniform1f(loc.uLipSize, Math.max(1, s.seaLip));
    gl.uniform1f(loc.uFace, s.seaFace || 0);
    gl.uniform1f(loc.uR, s.R || 0);
    gl.uniform1f(loc.uStep, STEP);
    const rot = s.seaRot || [1, 0];
    gl.uniform2f(loc.uSeaRot, rot[0], rot[1]);
    gl.uniform1i(loc.uLut0, 2); gl.uniform1i(loc.uLut1, 5); gl.uniform1i(loc.uDepthT, 6);
    gl.uniform1i(loc.uMh, mh | 0);
    const body = s.seaBody || [0.133, 0.243, 0.345], hor = s.hor || [0.3, 0.4, 0.5];
    gl.uniform3f(loc.uBody, body[0], body[1], body[2]);
    gl.uniform3f(loc.uHor, hor[0], hor[1], hor[2]);
    const sd = s.sunDir || [0, 0], se = Math.max(s.sunElev || 0, 0), sc = Math.sqrt(Math.max(0, 1 - se * se));
    gl.uniform3f(loc.uSunDir3, sd[0] * sc, sd[1] * sc, se);
    gl.uniform3f(loc.uEye, s.ax || 0, s.ay || 0, s.EH == null ? 0.12 : s.EH);
    gl.uniform1f(loc.uNm, s.nm == null ? 1 : s.nm);
    gl.uniform1f(loc.uHz, s.hz || 0);
    gl.uniform1f(loc.uHazeMax, s.hazeMax == null ? 1 : s.hazeMax);
    gl.uniform1f(loc.uDepth, s.depth || 200);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, pieceN, cellN);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    return tris + (pieceN / 3) * cellN;
  }
  return { draw };
}
