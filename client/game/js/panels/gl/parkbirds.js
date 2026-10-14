// GLASS 2 · THE PARK'S BIRDS. Gulls over the outfield, wheeling round in the floods' light the way
// they come in over a ballpark at night, and a murmuration of starlings over the skyline at dusk,
// gone to roost once it's dark.
//
//   · gulls: a few, each on its own circuit over the outfield, banking into it, flapping a while and
//     gliding a while, white underneath where the floods catch them;
//   · starlings: hundreds of dark points in one cloud that drifts and folds over the city, against
//     the light of the western sky.
//
// Both are one instanced draw each, worked out in the vertex shader from the world's clock, so a
// stopped clock draws them still and every TV has them in the same place. `gullAt` is the same sum
// on the CPU, for the gate.

import { HEIGHT_FOG_GLSL } from './fog.js';
import { declareProgram } from './programs.js';

// The gulls: how many; where their circuits' middles lie (within `bearing` degrees of the line out to
// centre field, `out` ft from home plate); how big the circuits are, none reaching further than
// `reach` from home plate, so they keep over the park and clear of the towers; how high they fly,
// how fast (ft/s), their wingspan (ft), and how fast and hard they flap.
export const GULLS = Object.freeze({
  n: 9, bearing: 22, out: Object.freeze([170, 240]), r: Object.freeze([50, 110]), reach: 340, y: Object.freeze([96, 170]),
  v: Object.freeze([20, 30]), span: 4.4, flapHz: 2.6, flap: 0.55,
});
// The starlings: how many, how far out their cloud hangs (ft) and how high, how far off centre field
// it may lean toward the sunset (degrees; further and the cameras that look out wouldn't see it),
// how big it is, and when in the dusk they're up (the sky's `night`, 0 by day to 1).
export const STARLINGS = Object.freeze({
  n: 2400, reach: 2000, y: 360, lean: 20, size: Object.freeze([260, 70, 160]), up: Object.freeze([0.02, 0.14]), roost: Object.freeze([0.45, 0.7]),
});

function hash01(i, salt) {
  let h = Math.imul((i | 0) ^ 0x27d4eb2d, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const mixR = (r, u) => r[0] + (r[1] - r[0]) * u;

// Each gull's circuit, as the vertex shader reads it: its middle (x, z), its radius, its height,
// its speed (ft/s, signed by the way round it goes), its phase and its seed. 8 floats a gull.
export function gullCircuits() {
  const out = new Float32Array(GULLS.n * 8);
  for (let i = 0; i < GULLS.n; i++) {
    const a = ((hash01(i, 1) * 2 - 1) * GULLS.bearing * Math.PI) / 180, d = mixR(GULLS.out, hash01(i, 2));
    out.set([Math.sin(a) * d, Math.cos(a) * d, Math.min(mixR(GULLS.r, hash01(i, 3)), GULLS.reach - d), mixR(GULLS.y, hash01(i, 4)),
      mixR(GULLS.v, hash01(i, 5)) * (hash01(i, 6) < 0.5 ? -1 : 1), hash01(i, 7) * Math.PI * 2, hash01(i, 8), 0], i * 8);
  }
  return out;
}
// Where gull `i` of `c` (gullCircuits) is at time t: [x, y, z].
export function gullAt(c, i, t) {
  const o = i * 8, th = c[o + 5] + (c[o + 4] * t) / c[o + 2];
  return [c[o] + c[o + 2] * Math.sin(th), c[o + 3] + 6 * Math.sin(0.37 * t + c[o + 6] * 40), c[o + 1] + c[o + 2] * Math.cos(th)];
}

const COMMON = `
uniform mat4 uVP; uniform vec3 uEye; uniform float uT; uniform float uMinW;
uniform float uFogDens; uniform float uFogH; uniform vec3 uFogCol;
${HEIGHT_FOG_GLSL}
float hazeTo(vec3 P) { return heightFog(uEye.y, P.y, length(uEye - P), uFogDens, uFogH); }`;

// A gull: its body and two wings, each in two panels, flapping about the root and the elbow.
const GULL_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec2 aPart;
layout(location = 2) in vec4 iA; layout(location = 3) in vec4 iB;
${COMMON}
uniform float uSize; uniform float uFlapHz; uniform float uFlap;
out vec3 vPos; out vec3 vN; out float vTip;
vec3 rollZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
void main() {
  float th = iB.y + iB.x * uT / iA.z, dir = sign(iB.x);
  vec3 C = vec3(iA.x + iA.z * sin(th), iA.w + 6.0 * sin(0.37 * uT + iB.z * 40.0), iA.y + iA.z * cos(th));
  // flapping a while and gliding a while, each on its own beat
  float env = smoothstep(0.3, 0.7, 0.5 + 0.5 * sin(0.21 * uT + iB.z * 6.2832));
  float a = env * uFlap * sin(6.2832 * uFlapHz * uT + iB.z * 31.0) + 0.08;
  vec3 p = aPos, n = vec3(0.0, -1.0, 0.0);
  float side = aPart.y;
  if (aPart.x > 0.5) {
    // the wing about its root, the outer panel further about the elbow
    vec3 q = vec3(abs(p.x) - 0.15, p.y, p.z);
    float b = a;
    if (aPart.x > 1.5) { vec3 e = vec3(q.x - 0.85, q.y, q.z); e = rollZ(e, a * 0.6); q = vec3(0.85, 0.0, 0.0) + e; b = a * 1.6; }
    q = rollZ(q, a);
    n = rollZ(vec3(0.0, -1.0, 0.0), b);
    p = vec3(side * (q.x + 0.15), q.y, q.z); n.x *= side;
  }
  p *= uSize;
  // heading round the circuit, banked into it
  vec3 fwd = normalize(vec3(cos(th), 0.0, -sin(th)) * dir), right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  float bank = 0.35 * dir;
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 r2 = right * cos(bank) + up * sin(bank), u2 = -right * sin(bank) + up * cos(bank);
  vec3 P = C + r2 * p.x + u2 * p.y + fwd * p.z;
  vPos = P; vN = normalize(r2 * n.x + u2 * n.y + fwd * n.z); vTip = step(1.75, abs(aPos.x));
  gl_Position = uVP * vec4(P, 1.0);
}`;
const GULL_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vN; in float vTip; out vec4 o;
${COMMON}
uniform vec3 uSkyUp; uniform vec3 uSkyDn; uniform vec3 uFlood;
void main() {
  // the side toward the eye: white underneath, grey on top, the tips black; lit by the sky above and
  // the ground below as the park is, and from below by the floods off the field
  vec3 N = normalize(vN); if (dot(N, uEye - vPos) < 0.0) N = -N;
  float under = clamp(-N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 alb = mix(mix(vec3(0.42, 0.44, 0.47), vec3(0.86, 0.86, 0.84), under), vec3(0.03), vTip);
  vec3 col = alb * (mix(uSkyUp, uSkyDn, under) + uFlood * (0.25 + 0.75 * under));
  o = vec4(mix(col, uFogCol, hazeTo(vPos)), 1.0);
}`;

// A starling: a dark point in the cloud.
const STAR_VS = `#version 300 es
layout(location = 0) in vec4 iS;
${COMMON}
uniform vec3 uAt; uniform vec3 uSize; uniform float uShow;
out vec2 vQ; out float vA;
void main() {
  int c = gl_VertexID;
  vec2 q = vec2((c == 1 || c == 4 || c == 5) ? 1.0 : -1.0, (c == 2 || c == 3 || c == 5) ? 1.0 : -1.0);
  float t = uT;
  // the cloud drifts, breathes and turns; the birds keep to a sheet that folds as it goes, and where
  // it folds toward the eye they pile up into the dark bands a murmuration has
  vec3 C = uAt + vec3(sin(0.023 * t) * 260.0, sin(0.031 * t + 1.0) * 60.0, sin(0.017 * t + 2.0) * 180.0);
  vec3 A = uSize * vec3(1.0 + 0.45 * sin(0.07 * t), 1.0 + 0.6 * sin(0.11 * t + 1.0), 1.0 + 0.5 * sin(0.05 * t + 2.0));
  vec3 u = iS.xyz;
  float fold = 0.9 * sin(u.x * 2.6 + 0.7 * t) + 0.45 * sin(u.z * 3.4 - 0.5 * t + u.x);
  vec3 p = vec3(u.x * A.x, (u.y * 0.28 + fold) * A.y, u.z * A.z);
  float r = 0.04 * t + 0.6 * sin(0.013 * t), cr = cos(r), sr = sin(r);
  p = vec3(cr * p.x + sr * p.z, p.y, -sr * p.x + cr * p.z);
  // each bird jitters about its place in the cloud
  p += vec3(sin(t * 1.7 + iS.w * 50.0), sin(t * 2.3 + iS.w * 70.0), sin(t * 1.3 + iS.w * 90.0)) * 4.0;
  vec3 P = C + p, toEye = uEye - P; float d = length(toEye); toEye /= d;
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), toEye) + vec3(1e-5, 0.0, 0.0)), up = cross(toEye, rt);
  float R = max(0.7, d * uMinW);
  vQ = q; vA = uShow * min(1.0, 0.7 * 0.7 / (R * R) + 0.35) * (1.0 - hazeTo(P));
  gl_Position = uVP * vec4(P + (rt * q.x + up * q.y) * R, 1.0);
}`;
const STAR_FS = `#version 300 es
precision highp float;
in vec2 vQ; in float vA; out vec4 o;
void main() { float d = length(vQ); if (d > 1.0) discard; float a = vA * (1.0 - smoothstep(0.5, 1.0, d)); o = vec4(vec3(0.004, 0.004, 0.005) * a, a); }`;

for (const [vs, fs] of [[GULL_VS, GULL_FS], [STAR_VS, STAR_FS]]) declareProgram(vs, fs);

// The gull, 5 floats a vertex: position (across, up, along, 4.2 across the wings, scaled to GULLS.span;
// wings mirrored by `side`), part (0 the body, 1 a wing's inner panel, 2 its outer) and side.
function gullMesh() {
  const out = [], tri = (a, b, c, part, side) => { for (const p of [a, b, c]) out.push(p[0] * (part ? side : 1), p[1], p[2], part, side); };
  tri([0, 0, 0.9], [0.18, 0, 0], [0, 0, -0.85], 0, 1); tri([0, 0, 0.9], [0, 0, -0.85], [-0.18, 0, 0], 0, 1);
  for (const s of [-1, 1]) {
    tri([0.15, 0, 0.28], [1.0, 0, 0.16], [1.0, 0, -0.22], 1, s); tri([0.15, 0, 0.28], [1.0, 0, -0.22], [0.15, 0, -0.26], 1, s);
    tri([1.0, 0, 0.16], [2.1, 0, -0.32], [1.0, 0, -0.22], 2, s);
  }
  return new Float32Array(out);
}
// Seeds for the starlings: a place in the unit ball each, and a jitter's phase.
function starSeeds(n) {
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    let x, y, z, k = 0;
    do { x = hash01(i, 10 + k) * 2 - 1; y = hash01(i, 20 + k) * 2 - 1; z = hash01(i, 30 + k) * 2 - 1; k++; } while (x * x + y * y + z * z > 1 && k < 8);
    out.set([x, y, z, hash01(i, 40)], i * 4);
  }
  return out;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// How many starlings are up at the sky's `night` (0 to 1): they gather as the sun goes and roost by
// dark. Only in the evening; at dawn they leave the roost without the show.
export const starlingsUp = (night, evening = true) => (evening ? smooth(STARLINGS.up[0], STARLINGS.up[1], night) * (1 - smooth(STARLINGS.roost[0], STARLINGS.roost[1], night)) : 0);
// The middle of the starlings' cloud: out past the outfield toward where the sun went down (`sun`,
// the sky's, a unit vector on the ground in the park's frame), no further off centre field than
// STARLINGS.lean.
export function starlingsOver(sun) {
  const lean = (STARLINGS.lean * Math.PI) / 180, a = sun ? Math.max(-lean, Math.min(lean, Math.atan2(sun[0], sun[2]))) : 0;
  return [Math.sin(a) * STARLINGS.reach, STARLINGS.y, Math.cos(a) * STARLINGS.reach];
}

// `prog(vs, fs)` is the ballpark's own builder. drawGulls(M, h, t, o) and drawStarlings(M, h, t, o):
// o { up and dn (the sky's ambient from above and the ground's from below), flood (the floods' light
// from below), night and sun (the sky's), evening, fogDens, fogH, fogCol, gulls, starlings (false to
// leave them out) }; the gulls go in with the opaque, the starlings laid over. Each returns
// { draws, tris }.
export function createParkBirds(gl, prog) {
  const G = prog(GULL_VS, GULL_FS), S = prog(STAR_VS, STAR_FS);
  const mesh = gullMesh(), circuits = gullCircuits(), seeds = starSeeds(STARLINGS.n);
  const gvao = gl.createVertexArray(), gbuf = gl.createBuffer(), cbuf = gl.createBuffer();
  gl.bindVertexArray(gvao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gbuf); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
  gl.bindBuffer(gl.ARRAY_BUFFER, cbuf); gl.bufferData(gl.ARRAY_BUFFER, circuits, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(3, 1);
  const svao = gl.createVertexArray(), sbuf = gl.createBuffer();
  gl.bindVertexArray(svao);
  gl.bindBuffer(gl.ARRAY_BUFFER, sbuf); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1);
  gl.bindVertexArray(null);
  const common = (P, M, h, t, o) => {
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u('uVP'), false, M.viewProj); gl.uniform3fv(P.u('uEye'), M.eye); gl.uniform1f(P.u('uT'), t);
    gl.uniform1f(P.u('uMinW'), (1.4 * Math.tan(((M.fov || 40) * Math.PI) / 360)) / Math.max(1, h || 1));
    gl.uniform1f(P.u('uFogDens'), o.fogDens || 0); gl.uniform1f(P.u('uFogH'), o.fogH || 160); gl.uniform3fv(P.u('uFogCol'), o.fogCol || [0, 0, 0]);
  };
  function drawGulls(M, h, t, o) {
    if (o.gulls === false) return { draws: 0, tris: 0 };
    common(G, M, h, t, o);
    gl.uniform1f(G.u('uSize'), GULLS.span / 4.2); gl.uniform1f(G.u('uFlapHz'), GULLS.flapHz); gl.uniform1f(G.u('uFlap'), GULLS.flap);
    gl.uniform3fv(G.u('uSkyUp'), o.up); gl.uniform3fv(G.u('uSkyDn'), o.dn || o.up); gl.uniform3fv(G.u('uFlood'), o.flood);
    gl.bindVertexArray(gvao); gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.length / 5, GULLS.n);
    return { draws: 1, tris: (mesh.length / 15) * GULLS.n };
  }
  function drawStarlings(M, h, t, o) {
    const show = o.starlings === false ? 0 : starlingsUp(o.night ?? 1, o.evening !== false);
    if (!(show > 0.01)) return { draws: 0, tris: 0 };
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    common(S, M, h, t, o);
    gl.uniform3fv(S.u('uAt'), starlingsOver(o.sun)); gl.uniform3fv(S.u('uSize'), STARLINGS.size); gl.uniform1f(S.u('uShow'), show);
    const n = Math.round(STARLINGS.n * Math.min(1, show * 1.4));
    gl.bindVertexArray(svao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    return { draws: 1, tris: n * 2 };
  }
  function dispose() { gl.deleteVertexArray(gvao); gl.deleteVertexArray(svao); for (const b of [gbuf, cbuf, sbuf]) gl.deleteBuffer(b); }
  return { drawGulls, drawStarlings, dispose };
}
