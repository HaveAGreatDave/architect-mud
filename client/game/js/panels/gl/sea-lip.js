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

const LIP_R = 18 / SEA_K;          // how far from the eye the lip is drawn, in tiles
const STEP = 0.3 / SEA_K;          // grid spacing, in tiles
const NV = 7;                      // rows round the curl
const K_PH = 0.24557 * SEA_K;      // the long swell's phase change per world tile along its wavevector
const LIP_PH = -0.2;               // where the lip sits on the swell, in seaSurfPhase's radians

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
    if (!((s.seaLip || 0) > 0) || !((s.seaSurf || 0) > 0)) return 0;
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
    return (pieceN / 3) * cellN;
  }
  return { draw };
}
