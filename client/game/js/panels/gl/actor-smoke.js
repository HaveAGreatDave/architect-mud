// GLASS 2 · A CIGARETTE GOING, ON THE PAVEMENT.
//
// Somebody on the street playing a smoker's clip (actor3d.js ACTOR_SMOKES: smoke, leanSmoke, walkSmoke) has a
// cigarette in their right hand. The crowd's body (gl/actors.js) has no fingers to hold one and the close-up figure
// (gl/street-hd.js) draws nothing it holds, so this draws it for both, off the right hand's bone the bake writes
// beside the head's (ACTOR_HEAD_BONES.handR). Four things, one program, one instanced pass for the solid and one for
// the light and the smoke:
//
//   - The cigarette: a filter (cyan for most people, cork or white for the rest), the paper and the lit end. It's
//     4.5 mm thick, so a figure under a couple of hundred pixels tall would lose it between pixels; it's kept at
//     least about a pixel wide.
//   - The ember: a glow on the lit end, faint at rest and bright while the filter is at the lips (a drag: how near
//     the filter is to the mouth, from the head's bone, so any clip that brings the hand up lights it). It's never
//     under SMOKE_TUNE.minPx, so a cigarette at the far end of a street at night is still a red point.
//   - The stream off the lit end: a ribbon whose spine is where the ember WAS over the last SMOKE_TUNE.stream
//     seconds (the clip's phase run back by that much, and a walker's own walk taken off), each point risen and
//     spread by its age. Nothing is simulated or stored, so it can't pop, and a hand coming down from a drag leaves
//     the smoke where it was.
//   - The exhale: a wider, fainter ribbon from the mouth, the same way, lit only for the stretch of each clip just
//     after the drag (SMOKE_EXHALE).
//
// Records are gl/actors.js's (windshield.js pushActorMesh); this reads nothing else. Nothing here is an entity: the
// filter's colour comes off the look's own colours, the same for the same person every time.

import { ACTOR_HEAD_BONES, ACTOR_SMOKES, actorSkinAt, ACTOR_BONE } from '../actor3d.js';
import { propBind } from '../figure.js';
import { linearOut, applyLinOut } from './colour.js';
import { declareProgram, layerProgram } from './programs.js';
import { makeVertexStream } from './stream.js';

export const SMOKE_TUNE = {
  on: 1,
  stream: 2.6,        // seconds of smoke on the ribbon off the lit end
  exhale: 2.4,        // and on the breath
  minPx: 1.4,         // the ember's least size on the screen, device pixels
  wind: [0.07, 0.03], // a drift on the smoke, metres a second, east and south
  max: 160,           // smokers drawn at most, the first the frame hands over
};
// For the console (__actorSmoke.stats): the last frame's records offered and smokers uploaded, and passes drawn so far.
export const smokeStats = { offered: 0, smokers: 0, uploads: 0, drawn: 0 };
SMOKE_TUNE.stats = smokeStats;
// Where a drag's breath comes out: the share of each smoker's clip at which it starts (just as the hand comes away
// from the mouth). The breath runs from there for about a sixth of the clip.
const SMOKE_EXHALE = { smoke: 0.47, leanSmoke: 0.47, walkSmoke: 0.6 };
// Of everybody, who smokes what: most filters are the cyan of the city's own brand, the rest cork or plain white.
const FILTERS = [[0.08, 0.74, 0.8], [0.78, 0.5, 0.24], [0.92, 0.92, 0.88]];
const filterOf = (u) => (u < 0.82 ? 0 : u < 0.93 ? 1 : 2);
// The mouth on the head's bone, in bind space (gl/figure-reach.js GOALS.mouth).
const MOUTH = [0, 1.574, 0.104];
const LEN = 0.082, FILT = 0.27, R0 = 0.0045;

// The cigarette in bind space on the right hand: held where the close-up figure holds one (figure.js propBind),
// pointing the way that puts the filter on the lips at the top of smokePose's drag. Solved the first time it's
// asked for, from the clip itself, so an edit to the clip keeps the filter in the mouth. Exported for the gate.
let _cig = null;
export function smokeCigarette() {
  if (_cig) return _cig;
  const g = propBind('cigarette', -1, 1.1), B = ACTOR_BONE;
  const S = actorSkinAt('smoke', 0.3), M = S[B.handR], H = S[B.head];
  const xf = (A, q) => [0, 1, 2].map((r) => A[r] * q[0] + A[4 + r] * q[1] + A[8 + r] * q[2] + A[12 + r]);
  const h = xf(M, g), m = xf(H, MOUTH), d = [h[0] - m[0], h[1] - m[1], h[2] - m[2]], l = Math.hypot(...d) || 1;
  // the mouth-to-grip direction taken back into the hand's frame, which is bind space for a bone at rest
  const ax = [0, 1, 2].map((c) => (M[c * 4] * d[0] + M[c * 4 + 1] * d[1] + M[c * 4 + 2] * d[2]) / l);
  const back = 0.014, filter = g.map((v, i) => v - ax[i] * back), ember = filter.map((v, i) => v + ax[i] * LEN);
  _cig = { filter, ember, axis: ax, mouth: MOUTH.slice() };
  return _cig;
}

// The vertices: the cigarette's tube, then the glow's quad, then the two ribbons. Each is [x, y, z, a, b, c]: the
// tube's bind-space point and its outward normal; anything else is (0, 0, 0) and [kind, along, side].
const SEG = 6, RIB = 18;
const K = { glow: 3, stream: 4, breath: 5 };
function buildVerts() {
  const C = smokeCigarette(), A = C.axis;
  const U = (() => { const t = Math.abs(A[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = [A[1] * t[2] - A[2] * t[1], A[2] * t[0] - A[0] * t[2], A[0] * t[1] - A[1] * t[0]]; const l = Math.hypot(...u); return u.map((v) => v / l); })();
  const V = [A[1] * U[2] - A[2] * U[1], A[2] * U[0] - A[0] * U[2], A[0] * U[1] - A[1] * U[0]];
  const out = [];
  // the tube: rings along it at the filter's end, its band, the paper and the lit end (t = 0 at the filter);
  // the normal's length carries t, so the fragment knows filter from paper
  const rings = [0, FILT, FILT + 0.001, 0.94, 0.98, 1];
  const at = (t, j, r) => {
    const th = (j / SEG) * Math.PI * 2, n = [0, 1, 2].map((k) => Math.cos(th) * U[k] + Math.sin(th) * V[k]);
    return [...[0, 1, 2].map((k) => C.filter[k] + A[k] * t * LEN + n[k] * r), ...n.map((v) => v * (1 + t))];
  };
  for (let i = 0; i < rings.length - 1; i++) {
    const t0 = rings[i], t1 = rings[i + 1], r1 = t1 === 1 ? R0 * 0.75 : R0;
    for (let j = 0; j < SEG; j++) {
      const a = at(t0, j, R0), b = at(t0, j + 1, R0), c = at(t1, j + 1, r1), d = at(t1, j, r1);
      out.push(a, b, c, a, c, d);
    }
  }
  // the ends: the filter's face and the ember's, fans to the axis (the normal along it, its length 1 + t as above)
  for (const [t, s] of [[0, -1], [1, 1]]) {
    const ctr = [...[0, 1, 2].map((k) => C.filter[k] + A[k] * t * LEN), ...A.map((v) => v * s * (1 + t))];
    for (let j = 0; j < SEG; j++) out.push(ctr, at(t, j, t ? R0 * 0.75 : R0), at(t, j + 1, t ? R0 * 0.75 : R0));
  }
  const solid = out.length;
  const q = (kind, a, s) => [0, 0, 0, kind, a, s];
  for (const [a, s] of [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]]) out.push(q(K.glow, a, s));
  for (const kind of [K.stream, K.breath]) {
    for (let i = 0; i < RIB; i++) {
      const a0 = i / RIB, a1 = (i + 1) / RIB;
      out.push(q(kind, a0, -1), q(kind, a1, -1), q(kind, a1, 1), q(kind, a0, -1), q(kind, a1, 1), q(kind, a0, 1));
    }
  }
  return { data: new Float32Array(out.flat()), solid, total: out.length };
}

const VERT = `#version 300 es
precision highp float;
precision highp int;
in vec3 aP;
in vec3 aQ;
// x, y, z, tiles a metre | clip A row0, frames, phase, heading | clip B row0, frames, phase, share of B |
// brightness, alpha, seed, unused | A's and B's seconds a cycle, the filter, where A's breath starts | how fast they're
// going, metres a second east and south (upload measures it)
in vec4 iPos;
in vec4 iClipA;
in vec4 iClipB;
in vec4 iLit;
in vec4 iMisc;
in vec4 iVel;
uniform highp sampler2D uBones;
uniform mat4 uViewProj;
uniform mat4 uView;
uniform vec2 uRes;
uniform float uTime;
uniform float uStream;
uniform float uBreath;
uniform float uMinPx;
uniform vec2 uWind;
uniform vec3 uFilterEnd;
uniform vec3 uEmberEnd;
uniform vec3 uMouth;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
out vec4 vC;
out vec3 vQ;
out float vFog;
mat4 boneOf(int row, int at) {
  vec4 r0 = texelFetch(uBones, ivec2(at, row), 0);
  vec4 r1 = texelFetch(uBones, ivec2(at + 1, row), 0);
  vec4 r2 = texelFetch(uBones, ivec2(at + 2, row), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
mat4 boneAt(vec4 c, int at) {
  float fr = fract(c.z) * c.y;
  int f0 = int(fr);
  int f1 = f0 + 1;
  if (float(f1) >= c.y) f1 = 0;
  float t = fr - float(f0);
  int b = int(c.x + 0.5);
  return boneOf(b + f0, at) * (1.0 - t) + boneOf(b + f1, at) * t;
}
// A bone 'back' seconds ago: each clip's phase run back by that much of its cycle.
mat4 boneBack(int at, float back) {
  vec4 a = iClipA;
  a.z -= back / max(iMisc.x, 0.1);
  mat4 M = boneAt(a, at);
  if (iClipB.w > 0.0) { vec4 b = iClipB; b.z -= back / max(iMisc.y, 0.1); M = M * (1.0 - iClipB.w) + boneAt(b, at) * iClipB.w; }
  return M;
}
// The mesh's frame (metres, Y up, facing +Z) onto the street's (tiles, Z up), as the body's VERT does it.
vec3 F;
vec3 L;
vec3 onStreet(vec3 p) { return iPos.xyz + (F * p.z + L * p.x + vec3(0.0, 0.0, p.y)) * iPos.w; }
vec3 dirOnStreet(vec3 d) { return F * d.z + L * d.x + vec3(0.0, 0.0, d.y); }
// How much of a drag is on at 'back' seconds ago: the filter at the lips.
float dragAt(float back) {
  vec3 f = (boneBack(${ACTOR_HEAD_BONES.handR}, back) * vec4(uFilterEnd, 1.0)).xyz;
  vec3 m = (boneBack(${ACTOR_HEAD_BONES.head}, back) * vec4(uMouth, 1.0)).xyz;
  return 1.0 - smoothstep(0.035, 0.11, distance(f, m));
}
// The breath at 'back' seconds ago, off A's clip: rising just after the drag, gone a sixth of a cycle later.
float breathAt(float back) {
  if (iMisc.w < 0.0) return 0.0;
  float p = fract(iClipA.z - back / max(iMisc.x, 0.1) - iMisc.w);
  return smoothstep(0.0, 0.03, p) * (1.0 - smoothstep(0.05, 0.17, p));
}
// A point on a ribbon, 'a' of the way along it (0 the source, now; 1 its oldest), in tiles.
vec3 spine(int kind, float a, float seed) {
  float T = kind == ${K.stream} ? uStream : uBreath, back = a * T;
  vec3 src;
  vec3 push = vec3(0.0);
  if (kind == ${K.stream}) {
    src = (boneBack(${ACTOR_HEAD_BONES.handR}, back) * vec4(uEmberEnd, 1.0)).xyz;
  } else {
    mat4 H = boneBack(${ACTOR_HEAD_BONES.head}, back);
    src = (H * vec4(uMouth, 1.0)).xyz;
    // the breath goes out forward and a little down, slowing as it spreads
    vec3 fw = normalize(mat3(H) * vec3(0.0, -0.25, 1.0));
    push = fw * 0.42 * (1.0 - exp(-2.6 * back));
  }
  vec3 w = onStreet(src) + dirOnStreet(push) * iPos.w;
  // a walker has moved on since: the smoke stays where it was let go
  w -= vec3(iVel.xy, 0.0) * back * iPos.w;
  // up, faster as it warms the air round it; a wander that travels up the stream; the wind
  float rise = kind == ${K.stream} ? 0.09 * back + 0.045 * back * back : 0.02 * back + 0.035 * back * back;
  float wob = (0.003 + 0.05 * a * a) * (kind == ${K.stream} ? 1.0 : 1.6);
  vec2 wv = vec2(sin(7.0 * a - uTime * 1.7 + seed * 6.28), cos(5.3 * a - uTime * 1.3 + seed * 11.0));
  w += vec3(wv * wob + uWind * back * (0.4 + 0.6 * a), rise) * iPos.w;
  return w;
}
void main() {
  F = vec3(cos(iClipA.w), sin(iClipA.w), 0.0);
  L = vec3(F.y, -F.x, 0.0);
  int kind = int(aQ.x + 0.5);
  float seed = iLit.z, alpha = iLit.y;
  vec3 eye = -transpose(mat3(uView)) * uView[3].xyz;
  vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]), up = vec3(uView[0][1], uView[1][1], uView[2][1]);
  vec3 w;
  vQ = aQ;
  float drag = dragAt(0.0);
  if (length(aP) > 0.0) {
    // the cigarette: the tube's bind point on the hand, kept about a pixel thick (the normal's length carries t)
    float t = length(aQ) - 1.0;
    vec3 n = aQ / max(length(aQ), 1e-4);
    mat4 M = boneBack(${ACTOR_HEAD_BONES.handR}, 0.0);
    vec3 axisP = aP - n * ${R0};
    w = onStreet((M * vec4(axisP, 1.0)).xyz);
    vec4 c0 = uViewProj * vec4(w, 1.0), c1 = uViewProj * vec4(w + right * 0.01, 1.0);
    float pxPerTile = length((c1.xy / max(c1.w, 1e-4) - c0.xy / max(c0.w, 1e-4)) * uRes * 0.5) / 0.01;
    float r = clamp(0.55 / max(pxPerTile, 1e-4), ${R0} * iPos.w, ${R0 * 4} * iPos.w);
    w += dirOnStreet(mat3(M) * n) * r;
    vQ = vec3(0.0, t, 0.0);
    vC = vec4(drag, iMisc.z, iLit.x, alpha);
  } else if (kind == ${K.glow}) {
    // the ember's glow, on the lit end, a touch toward the eye so the tip doesn't cut it
    vec3 e = onStreet((boneBack(${ACTOR_HEAD_BONES.handR}, 0.0) * vec4(uEmberEnd, 1.0)).xyz);
    e += normalize(eye - e) * 0.01 * iPos.w;
    float flick = 1.0 + 0.18 * sin(uTime * 23.0 + seed * 40.0) * sin(uTime * 7.1 + seed * 9.0);
    float r = (0.011 + 0.034 * drag) * flick * iPos.w;
    vec4 c = uViewProj * vec4(e, 1.0);
    vec4 cr = uViewProj * vec4(e + right * r, 1.0);
    float rn = max(length(cr.xy / max(cr.w, 1e-4) - c.xy / max(c.w, 1e-4)), uMinPx * 2.0 / uRes.y);
    vec2 corner = vec2(aQ.y * 2.0 - 1.0, aQ.z);
    c.xy += corner * rn * vec2(uRes.y / uRes.x, 1.0) * c.w;
    gl_Position = c;
    vQ = vec3(float(kind), corner);
    vC = vec4(drag, flick, iLit.x, alpha);
    float ff = clamp((c.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
    vFog = ff * ff * uFogAmt;
    return;
  } else {
    // a ribbon: its spine here and a little further on, and its width across the line of sight
    float a = aQ.y, da = 1.0 / ${RIB}.0;
    vec3 p0 = spine(kind, a, seed), p1 = spine(kind, min(1.0, a + da * 0.5), seed), p2 = spine(kind, max(0.0, a - da * 0.5), seed);
    vec3 tg = p1 - p2;
    vec3 side = cross(tg, eye - p0);
    side = length(side) > 1e-9 ? normalize(side) : right;
    float wd = (kind == ${K.stream} ? 0.005 + 0.1 * a * a : 0.018 + 0.15 * a) * iPos.w;
    // never under about a pixel across, thinned to match, so a stream down the street still reads and doesn't crawl
    vec4 q0 = uViewProj * vec4(p0, 1.0), q1 = uViewProj * vec4(p0 + right * 0.01, 1.0);
    float pxPerTile = length((q1.xy / max(q1.w, 1e-4) - q0.xy / max(q0.w, 1e-4)) * uRes * 0.5) / 0.01;
    float least = 0.8 / max(pxPerTile, 1e-4), thin = clamp(wd / least, 0.25, 1.0);
    w = p0 + side * aQ.z * max(wd, least);
    float k = (kind == ${K.stream} ? smoothstep(0.0, 0.04, a) * pow(1.0 - a, 1.3) * 0.62 : breathAt(a * uBreath) * pow(1.0 - a, 1.1) * 0.62) * thin;
    vC = vec4(drag, k, iLit.x, alpha);
  }
  vec4 clip = uViewProj * vec4(w, 1.0);
  gl_Position = clip;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;

const FRAG = linearOut(`#version 300 es
precision highp float;
in vec4 vC;
in vec3 vQ;
in float vFog;
uniform vec3 uFog;
uniform vec3 uKeyDir;
uniform float uPass;
uniform float uTime;
uniform float uDay;
out vec4 outColor;
float h1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
void main() {
  int kind = int(vQ.x + 0.5);
  float drag = vC.x, lum = vC.z, alpha = vC.w;
  if (uPass < 0.5) {
    // the cigarette
    if (kind != 0) discard;
    float t = vQ.y;
    int fi = int(vC.y + 0.5);
    vec3 filt = fi == 0 ? vec3(${FILTERS[0].join(', ')}) : fi == 1 ? vec3(${FILTERS[1].join(', ')}) : vec3(${FILTERS[2].join(', ')});
    vec3 col = t < ${FILT} ? filt : vec3(0.95, 0.94, 0.9);
    // the band where the filter meets the paper, and the ash before the lit end
    col = mix(col, filt * 0.55, 1.0 - smoothstep(0.0, 0.015, abs(t - ${FILT})));
    col = mix(col, vec3(0.32, 0.3, 0.29), smoothstep(0.9, 0.94, t));
    col *= lum;
    float lit = smoothstep(0.955, 0.99, t);
    col = mix(col, vec3(1.0, 0.28, 0.05) * (0.8 + 2.2 * drag), lit);
    col = mix(col, uFog, vFog);
    outColor = vec4(col * alpha, alpha);
    return;
  }
  if (kind == 0) discard;
  if (kind == ${K.glow}) {
    // a hot core and a soft halo, brighter on the drag and brighter still against the dark
    float r = length(vQ.yz);
    if (r > 1.0) discard;
    float g = exp(-r * r * 4.5), core = exp(-r * r * 22.0);
    float k = (0.35 + 1.9 * drag) * vC.y * mix(1.8, 0.7, uDay);
    vec3 col = vec3(1.0, 0.11, 0.02) * g * k + vec3(1.0, 0.55, 0.3) * core * k * (0.2 + 0.8 * drag);
    col *= 1.0 - vFog;
    outColor = vec4(col * alpha, 0.0);
    return;
  }
  // smoke: soft across the ribbon, broken up along it, a cool grey that the night takes down
  float across = 1.0 - vQ.z * vQ.z;
  float a = vQ.y;
  float br = vn(vec2(a * 9.0 - uTime * 0.9, vQ.z * 1.7 + float(kind) * 3.0)) * 0.7 + 0.5;
  float k = vC.y * pow(max(across, 0.0), 1.6) * br * alpha;
  vec3 col = vec3(0.66, 0.69, 0.74) * mix(0.32, 1.0, uDay) * mix(1.0, lum, 0.5);
  // the first of the stream, by the lit end, takes the ember's colour at night
  if (kind == ${K.stream}) col += vec3(0.6, 0.12, 0.02) * (1.0 - smoothstep(0.0, 0.08, a)) * (1.0 - uDay) * (0.3 + drag);
  col = mix(col, uFog, vFog);
  k *= 1.0 - 0.6 * vFog;
  outColor = vec4(col * k, k);
}`, 'outColor');

// Per instance: 24 floats (VERT's inputs in order).
const STRIDE = 24;
function hash3(c) {
  let h = Math.imul((c[0] | 0) + 0x9e37, 0x85ebca6b) ^ Math.imul((c[1] | 0) + 0x632b, 0xc2b2ae35) ^ Math.imul((c[2] | 0) + 0x1b87, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
// The 0..1 a look's own colours hash to, for its seed and its filter.
const seeds = new WeakMap();
function seedOf(o) {
  let s = seeds.get(o);
  if (s == null) { s = o && o.coat ? hash3([...o.coat.slice(0, 1), ...(o.legs || [0]).slice(0, 1), ...(o.hair || [0]).slice(0, 1)]) : 0.5; if (o) seeds.set(o, s); }
  return s;
}

// How fast somebody's going, metres a second east and south, off where their record was last frame (kept by their
// look, which is theirs for as long as they're in view), eased so a stride's surge doesn't shake the smoke. A jump
// (the map window recentring under them) reads as standing still.
const motion = new WeakMap();
function velOf(r) {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000, o = r.o;
  if (!o) return [0, 0];
  let m = motion.get(o);
  if (!m) { m = { x: r.x, y: r.y, t: now, vx: 0, vy: 0 }; motion.set(o, m); return [0, 0]; }
  const dt = now - m.t;
  if (dt > 1e-3) {
    let vx = (r.x - m.x) / dt / (r.s || 1), vy = (r.y - m.y) / dt / (r.s || 1);
    if (Math.hypot(vx, vy) > 4 || dt > 1) vx = vy = 0;
    const k = Math.min(1, dt / 0.4);
    m.vx += (vx - m.vx) * k; m.vy += (vy - m.vy) * k; m.x = r.x; m.y = r.y; m.t = now;
  }
  return [m.vx, m.vy];
}

export function createActorSmoke(gl) {
  const prog = layerProgram(gl, VERT, FRAG, 'actor smoke');
  const A = (n) => gl.getAttribLocation(prog, n), U = (n) => gl.getUniformLocation(prog, n);
  const loc = { p: A('aP'), q: A('aQ') };
  const inst = [['iPos', 0], ['iClipA', 4], ['iClipB', 8], ['iLit', 12], ['iMisc', 16], ['iVel', 20]].map(([n, off]) => [A(n), off]).filter(([l]) => l >= 0);
  const u = Object.fromEntries(['uBones', 'uViewProj', 'uView', 'uRes', 'uTime', 'uStream', 'uBreath', 'uMinPx', 'uWind', 'uFilterEnd', 'uEmberEnd', 'uMouth',
    'uFogNear', 'uFogFar', 'uFogAmt', 'uFog', 'uKeyDir', 'uPass', 'uDay'].map((n) => [n, U(n)]));
  const V = buildVerts(), C = smokeCigarette();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, V.data, gl.STATIC_DRAW);
  if (loc.p >= 0) { gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 24, 0); }
  if (loc.q >= 0) { gl.enableVertexAttribArray(loc.q); gl.vertexAttribPointer(loc.q, 3, gl.FLOAT, false, 24, 12); }
  gl.bindVertexArray(null);
  // the instances stream through gl/stream.js; the divisor is VAO state, so it is set once, here
  const stream = makeVertexStream(gl, vao, STRIDE, inst.map(([l, off]) => [l, 4, off * 4]), STRIDE * 16);
  gl.bindVertexArray(vao);
  for (const [l] of inst) gl.vertexAttribDivisor(l, 1);
  gl.bindVertexArray(null);
  let data = new Float32Array(STRIDE * 16), n = 0;

  // This frame's smokers, out of gl/actors.js's records, with the near bake's clip rows (the bones are the near
  // bake's, whichever body draws the person).
  function upload(recs, bake) {
    n = 0;
    smokeStats.offered = recs ? recs.length : 0; smokeStats.smokers = 0; smokeStats.uploads++;
    if (!SMOKE_TUNE.on || !bake || !bake.bones || !recs) return 0;
    for (const r of recs) {
      const a = ACTOR_SMOKES.has(r.clip), b = !!(r.clip2 && ACTOR_SMOKES.has(r.clip2) && r.mix > 0);
      if (!a && !b) continue;
      if (n >= SMOKE_TUNE.max) break;
      const Ac = bake.clips[r.clip] || bake.clips.idle, Bc = r.clip2 ? bake.clips[r.clip2] : null;
      const share = (a ? 1 - (Bc ? r.mix || 0 : 0) : 0) + (b ? r.mix : 0);
      if (share <= 0.01) continue;
      if (data.length < (n + 1) * STRIDE) { const d = new Float32Array(data.length * 2); d.set(data); data = d; }
      const o = n * STRIDE, sd = seedOf(r.o);
      data[o] = r.x; data[o + 1] = r.y; data[o + 2] = r.z || 0; data[o + 3] = r.s;
      data[o + 4] = Ac.row0; data[o + 5] = Ac.len; data[o + 6] = r.ph || 0; data[o + 7] = r.hd || 0;
      data[o + 8] = Bc ? Bc.row0 : 0; data[o + 9] = Bc ? Bc.len : 1; data[o + 10] = r.ph2 || 0; data[o + 11] = Bc ? (r.mix || 0) : 0;
      data[o + 12] = r.lum == null ? 1 : r.lum; data[o + 13] = (r.a == null ? 1 : r.a) * Math.min(1, share);
      data[o + 14] = sd; data[o + 15] = 0;
      const v = velOf(r);
      data[o + 20] = v[0]; data[o + 21] = v[1]; data[o + 22] = 0; data[o + 23] = 0;
      data[o + 16] = Ac.dur || 4; data[o + 17] = Bc ? Bc.dur || 4 : 4;
      data[o + 18] = filterOf(hash3([Math.floor(sd * 65536), 7, 11])); data[o + 19] = a && SMOKE_EXHALE[r.clip] != null ? SMOKE_EXHALE[r.clip] : -1;
      n++;
    }
    smokeStats.smokers = n;
    if (!n) return 0;
    stream.write(data, n * STRIDE);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return n;
  }

  // After the people, in their pass: the cigarettes into the depth, then the glow and the smoke over everything,
  // depth-tested but not written, so the smoke doesn't cut itself. `bindBones(unit)` binds the bone texture.
  function draw(VP, VM, opts, bindBones, uni) {
    if (!n) return 0;
    gl.useProgram(prog); applyLinOut(gl, prog);
    bindBones(BONE_UNIT_SMOKE);
    gl.uniform1i(u.uBones, BONE_UNIT_SMOKE);
    gl.uniformMatrix4fv(u.uViewProj, false, VP);
    gl.uniformMatrix4fv(u.uView, false, VM);
    gl.uniform2f(u.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(u.uTime, ((typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000) % 3600);
    gl.uniform1f(u.uStream, SMOKE_TUNE.stream);
    gl.uniform1f(u.uBreath, SMOKE_TUNE.exhale);
    gl.uniform1f(u.uMinPx, SMOKE_TUNE.minPx * (opts.nightDim > 0 && opts.nightDim < 0.9 ? 1 : 0.6));
    gl.uniform2f(u.uWind, SMOKE_TUNE.wind[0], SMOKE_TUNE.wind[1]);
    gl.uniform3fv(u.uFilterEnd, C.filter);
    gl.uniform3fv(u.uEmberEnd, C.ember);
    gl.uniform3fv(u.uMouth, C.mouth);
    const f = opts.fog;
    gl.uniform3f(u.uFog, f ? f.col[0] : 0, f ? f.col[1] : 0, f ? f.col[2] : 0);
    gl.uniform1f(u.uFogNear, f ? f.near : 1e9);
    gl.uniform1f(u.uFogFar, f ? f.far : 1e9 + 1);
    gl.uniform1f(u.uFogAmt, f ? f.amt : 0);
    gl.uniform3fv(u.uKeyDir, uni.key);
    // how much of the day it is: the wall's night dim (world.js nightDim), 1 by day
    gl.uniform1f(u.uDay, opts.nightDim > 0 ? Math.max(0, Math.min(1, (opts.nightDim - 0.45) / 0.55)) : 1);
    gl.bindVertexArray(vao);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(u.uPass, 0);
    gl.depthMask(true);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, V.solid, n);
    gl.uniform1f(u.uPass, 1);
    gl.depthMask(false);
    gl.drawArraysInstanced(gl.TRIANGLES, V.solid, V.total - V.solid, n);
    gl.depthMask(true);
    smokeStats.drawn++;
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0 + BONE_UNIT_SMOKE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return n;
  }
  return { upload, draw, get count() { return n; } };
}
// gl/actors.js's bone unit: the same texture, bound again for this program.
const BONE_UNIT_SMOKE = 22;
globalThis.__actorSmoke = SMOKE_TUNE;

declareProgram(VERT, FRAG);
