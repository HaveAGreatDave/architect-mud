// A room with no shell (`flags.room.void`, docs/proposals/the-inbetween.md, phase 1). room-mesh.js builds no walls, floor
// or ceiling for it and records `voidRoom` on the mesh: the floor's height, the room's middle, which way is north and
// each piece's spot and reach. This layer draws what's there instead:
//
//   the field   every pixel the room leaves empty, drawn first and writing no depth. 'white' is white on white with
//               no edge: a slow drift of warm and cool whites round the view, a little brighter at eye height, so
//               the eye always has something to rest on and never finds where it ends. North, the white thins to a
//               pale blue with a faint grid through it, like lines through paper (the Lattice is that way).
//               'black' is the same with the light taken out, for the Broadcast.
//   the floor   only where something stands. A disc of faintly ruled surface under you that forms as you step and
//               fades about a metre behind you, each step leaving a disc that goes in a second and a half. Each
//               piece has a disc of its own that stays. A soft shadow at the middle of each, and on a footfall one
//               thin ring that runs out like a drop on still water (not on a phone).
//
// It decides nothing and reads nothing off the server: where you are is the camera.

import { layerProgram } from './programs.js';
import { invert } from './core/mat4.js';

const DISCS = 24, RINGS = 8, TRAIL = 14;
const STEP = 0.7;            // metres walked between footfalls
const TRAIL_S = 1.5;         // how long a footfall's disc takes to go
const RING_S = 1.3, RING_V = 1.1;

const FIELD_VS = `#version 300 es
out vec2 vNdc;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0; vNdc = p; gl_Position = vec4(p, 0.9999, 1.0); }`;

const FIELD_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
out vec4 o;
uniform mat4 uInvVP;
uniform vec3 uEye;
uniform vec2 uNorth;
uniform float uT, uDark, uBlue, uRush, uArrive;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0), b = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  // the drift: two slow layers of noise on the direction, warm one way and cool the other
  float t = uT * 0.02;
  float n = noise(d * 2.2 + vec3(t, -t * 0.7, t * 0.4)) * 0.65 + noise(d * 5.0 - vec3(t * 1.3, t, 0.0)) * 0.35;
  vec3 warm = vec3(1.0, 0.985, 0.955), cool = vec3(0.94, 0.965, 1.0);
  vec3 c = mix(cool, warm, smoothstep(0.25, 0.75, n));
  // a soft band of extra light at eye height, and the white a touch greyer straight up and straight down
  c *= 0.93 + 0.07 * exp(-d.y * d.y * 9.0);
  // north: the white thins to blue, and the Lattice's grid shows through it, finer the further you look
  float nk = smoothstep(0.35, 0.95, dot(normalize(vec2(d.x, d.z)), uNorth)) * (1.0 - abs(d.y));
  vec2 g = vec2(atan(d.x, d.z) * 9.0, d.y * 18.0);
  vec2 gf = abs(fract(g) - 0.5);
  float grid = smoothstep(0.47, 0.5, max(gf.x, gf.y));
  // 'lattice' (uBlue): the blue all round and the grid in every direction, brighter
  float bk = max(nk, uBlue);
  c = mix(c, vec3(0.80, 0.88, 1.0), bk * (0.45 + 0.25 * uBlue));
  c = mix(c, vec3(0.55, 0.72, 1.0), bk * grid * (0.35 + 0.4 * uBlue));
  // 'black': the same drift and grid with the light taken out
  c = mix(c, c * 0.025, uDark);
  // 'collapse' (uRush): everything drawn toward one point north, streaking in toward it
  float ahead = max(0.0, dot(normalize(vec2(d.x, d.z)), uNorth)) * (1.0 - abs(d.y));
  float streak = noise(vec3(atan(d.x, d.z) * 40.0, d.y * 40.0, uT * 3.0 - ahead * 6.0));
  c = mix(c, vec3(1.0), uRush * pow(ahead, 6.0));
  c += uRush * smoothstep(0.7, 1.0, streak) * ahead * 0.5;
  // the arrival (uArrive 0 to 1): black, and the white rising from under your feet until it's all round you, a thin
  // bright edge where it's reached
  float front = -1.3 + 2.6 * uArrive, rise = 1.0 - smoothstep(front - 0.32, front, d.y);
  float edge = exp(-pow((d.y - front) / 0.06, 2.0)) * (1.0 - uArrive) * step(0.001, uArrive);
  c = mix(vec3(0.004, 0.006, 0.012), c, rise) + vec3(0.6, 0.85, 1.0) * edge;
  o = vec4(c, 1.0);
}`;

const FLOOR_VS = `#version 300 es
in vec2 aP;
uniform mat4 uVP;
uniform vec3 uC;
uniform float uY, uR;
out vec2 vW;
void main() { vW = uC.xz + aP * uR; gl_Position = uVP * vec4(vW.x, uY, vW.y, 1.0); }`;

const FLOOR_FS = `#version 300 es
precision highp float;
in vec2 vW;
out vec4 o;
uniform vec4 uDisc[${DISCS}];
uniform int uDiscN;
uniform vec4 uRing[${RINGS}];
uniform int uRingN;
uniform float uDark, uFade, uGlow;
void main() {
  float a = 0.0, sh = 0.0;
  for (int i = 0; i < ${DISCS}; i++) {
    if (i >= uDiscN) break;
    vec4 D = uDisc[i];
    float r = length(vW - D.xy);
    a = max(a, D.w * (1.0 - smoothstep(D.z * 0.55, D.z, r)));
    sh = max(sh, D.w * (1.0 - smoothstep(0.0, D.z * 0.42, r)));
  }
  float ring = 0.0;
  for (int i = 0; i < ${RINGS}; i++) {
    if (i >= uRingN) break;
    vec4 R = uRing[i];
    ring = max(ring, R.w * (1.0 - smoothstep(0.0, 0.018, abs(length(vW - R.xy) - R.z))));
  }
  if (a < 0.004 && ring < 0.004) discard;
  // the print's scan slice (uGlow): each piece's disc as a plane of light at the height being printed
  if (uGlow > 0.0) { o = vec4(vec3(0.72, 0.94, 1.0) * 1.4, uGlow * min(1.0, a * 0.35 + sh * 0.25)); return; }
  // the surface: a pale grey, ruled faintly every half metre, the rules finer than a hair at the edge of the disc
  vec2 f = abs(fract(vW * 2.0) - 0.5);
  float rule = 1.0 - smoothstep(0.0, 0.025, min(f.x, f.y));
  vec3 c = vec3(0.86, 0.875, 0.89) - rule * 0.05 - sh * 0.24;
  vec3 rc = vec3(0.70, 0.74, 0.80);
  float alpha = max(a * 0.85, ring * 0.7);
  c = mix(c, rc, ring / max(alpha, 0.001) * 0.7);
  o = vec4(mix(c, c * 0.06, uDark), alpha * uFade);
}`;

// THE ARRIVAL'S POINTS: you, as a cloud of light that gathers out of the dark into a body standing in front of you, holds
// and breathes, then rushes into your eyes. Each point has a spot on the body (aT, body frame: x right, y up, z toward
// you) and three randoms (aS): when it sets off, where round you it starts and how it shimmers.
const POINTS_VS = `#version 300 es
in vec3 aT;
in vec3 aS;
uniform mat4 uVP;
uniform vec3 uBase, uEye;
uniform vec2 uRight, uToward;
uniform float uT, uPx;
out float vA;
void main() {
  float del = aS.x * 1.6;
  float g = clamp((uT - 0.3 - del) / 2.2, 0.0, 1.0); g = g * g * (3.0 - 2.0 * g);
  vec3 tgt = uBase + vec3(uRight.x, 0.0, uRight.y) * aT.x + vec3(0.0, aT.y, 0.0) + vec3(uToward.x, 0.0, uToward.y) * aT.z;
  float th = aS.y * 6.2831853, ph = acos(aS.z * 2.0 - 1.0), R = 5.0 + aS.x * 7.0;
  vec3 st = uBase + vec3(sin(ph) * cos(th), cos(ph) * 0.6 + 0.2, sin(ph) * sin(th)) * R;
  vec3 p = mix(st, tgt, g), q = p - uBase;
  float a = (1.0 - g) * 2.5, ca = cos(a), sa = sin(a);
  p = uBase + vec3(q.x * ca - q.z * sa, q.y, q.x * sa + q.z * ca);
  p += (aS - 0.5) * 0.02 * sin(uT * 3.0 + aS.y * 40.0) * g;
  float r = clamp((uT - 10.0) / 1.6, 0.0, 1.0); r *= r;
  p = mix(p, uEye + (p - uEye) * 0.04, r);
  vA = (0.25 + 0.75 * g) * (1.0 - smoothstep(0.7, 1.0, r)) * smoothstep(0.0, 0.5, uT - del * 0.3);
  gl_Position = uVP * vec4(p, 1.0);
  gl_PointSize = clamp(uPx * 0.022 / max(gl_Position.w, 0.1), 1.5, 14.0);
}`;
const POINTS_FS = `#version 300 es
precision highp float;
in float vA;
out vec4 o;
uniform float uOnWhite;
void main() {
  float d = length(gl_PointCoord - 0.5), a = smoothstep(0.5, 0.0, d) * vA;
  if (a < 0.01) discard;
  vec3 c = mix(vec3(0.75, 0.9, 1.0) * 1.6, vec3(0.16, 0.5, 0.95), uOnWhite);
  o = vec4(c, a);
}`;

// The body the points gather into: capsules (a, b, radius) in metres, feet at 0, x right, z toward you
const BODY = [
  [[0, 1.6, 0], [0, 1.66, 0], 0.11], [[0, 1.44, 0], [0, 1.52, 0], 0.05], [[0, 1.0, 0], [0, 1.36, 0], 0.17],
  [[-0.1, 0.93, 0], [0.1, 0.93, 0], 0.13],
  [[-0.21, 1.4, 0], [-0.27, 1.12, 0.02], 0.05], [[-0.27, 1.12, 0.02], [-0.29, 0.85, 0.05], 0.04],
  [[0.21, 1.4, 0], [0.27, 1.12, 0.02], 0.05], [[0.27, 1.12, 0.02], [0.29, 0.85, 0.05], 0.04],
  [[-0.1, 0.88, 0], [-0.11, 0.5, 0.01], 0.075], [[-0.11, 0.5, 0.01], [-0.12, 0.08, 0], 0.055],
  [[0.1, 0.88, 0], [0.11, 0.5, 0.01], 0.075], [[0.11, 0.5, 0.01], [0.12, 0.08, 0], 0.055],
];
function bodyPoints(n, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const w = BODY.map(([a, b, r]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * r + r * r * 2), W = w.reduce((x, y) => x + y, 0);
  const out = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    let pick = rnd() * W, k = 0;
    while (k < BODY.length - 1 && pick > w[k]) pick -= w[k++];
    const [a, b, r] = BODY[k], t = rnd(), th = rnd() * Math.PI * 2, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    out.set([x + Math.cos(th) * r * (k === 2 ? 1.15 : 1), y + (k === 0 ? Math.sin(th * 0.5) * r * 0.6 : 0), z + Math.sin(th) * r * 0.7, rnd(), rnd(), rnd()], i * 6);
  }
  return out;
}

// THE ARRIVAL'S CLOCK, in seconds from the first frame the place is drawn (docs/proposals/the-inbetween.md):
//   0-3   black; the points gather into a body      3-5   the white rises from your feet; the floor forms
//   5-8   what's in the room prints in, floor up     8-10  the people appear (the attendant)
//   10-12 the body you were watching rushes into your eyes, and you're standing there
export const ARRIVAL_S = 12;
const PRINT_H = 3.2;   // metres the print sweeps up through


// how each kind of void looks: the In Between's white, the Lattice's blue, the Broadcast's black, the Collapse's rush
export const KIND_LOOK = Object.freeze({
  white: { dark: 0, blue: 0, rush: 0 }, lattice: { dark: 0, blue: 1, rush: 0 },
  black: { dark: 1, blue: 0, rush: 0 }, collapse: { dark: 0.35, blue: 0.3, rush: 1 },
});
export const VOID_KINDS = Object.freeze(Object.keys(KIND_LOOK));

export function createVoidLayer(gl, { phone = false } = {}) {
  const P = (vs, fs, label) => { const p = layerProgram(gl, vs, fs, label), u = {}; return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) }; };
  const FIELD = P(FIELD_VS, FIELD_FS, 'void field'), FLOOR = P(FLOOR_VS, FLOOR_FS, 'void floor'), PTS = P(POINTS_VS, POINTS_FS, 'void points');
  // the arrival's points: fewer on a phone
  const NPTS = phone ? 500 : 2400, pdata = bodyPoints(NPTS), pvao = gl.createVertexArray(), pbuf = gl.createBuffer();
  gl.bindVertexArray(pvao);
  gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
  gl.bufferData(gl.ARRAY_BUFFER, pdata, gl.STATIC_DRAW);
  for (const [name, off] of [['aT', 0], ['aS', 12]]) { const l = gl.getAttribLocation(PTS.p, name); if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 24, off); } }
  gl.bindVertexArray(null);
  const empty = gl.createVertexArray();
  // the floor: a fan of a disc 40 m across round the room's middle, which the discs cut down to what's there
  const fan = [], N = 48;
  for (let i = 0; i < N; i++) { const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2; fan.push(0, 0, Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)); }
  const vao = gl.createVertexArray(), buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fan), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(FLOOR.p, 'aP');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  let room = null, last = null, walked = 0;
  const trail = [], rings = [];
  const inv = new Float32Array(16), disc = new Float32Array(DISCS * 4), ring = new Float32Array(RINGS * 4);
  const north = [0, 1];

  function setRoom(v) {
    room = v || null; last = null; walked = 0; trail.length = 0; rings.length = 0;
    if (room) { const l = Math.hypot(room.north[0], room.north[1]) || 1; north[0] = room.north[0] / l; north[1] = room.north[1] / l; }
  }
  // once a frame: footfalls from how far the camera has walked
  function step(now, eye) {
    const s = now / 1000;
    if (last) {
      const dx = eye[0] - last[0], dz = eye[2] - last[2], d = Math.hypot(dx, dz);
      // a jump (a teleport, the room set) isn't a walk
      if (d < 1.5) walked += d;
      if (walked >= STEP) {
        walked = 0;
        trail.push([eye[0], eye[2], s]); if (trail.length > TRAIL) trail.shift();
        if (!phone) { rings.push([eye[0], eye[2], s]); if (rings.length > RINGS) rings.shift(); }
      }
    }
    last = [eye[0], eye[2]];
    while (trail.length && s - trail[0][2] > TRAIL_S) trail.shift();
    while (rings.length && s - rings[0][2] > RING_S) rings.shift();
  }
  // the field, first of all, behind everything and writing no depth. `o` overrides the room's own: its `north` and its
  // `look` ({ dark, blue, rush }, each 0 to 1), which a place blends between its rooms as you walk (gl/interiors.js)
  function field(vp, eye, now, o = null) {
    if (!room && !o) return;
    const R = o || room, look = R.look || KIND_LOOK[R.kind] || KIND_LOOK.white;
    if (o?.north) { const l = Math.hypot(o.north[0], o.north[1]) || 1; north[0] = o.north[0] / l; north[1] = o.north[1] / l; }
    invert(vp, inv);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
    gl.useProgram(FIELD.p);
    gl.uniformMatrix4fv(FIELD.u('uInvVP'), false, inv);
    gl.uniform3fv(FIELD.u('uEye'), eye);
    gl.uniform2f(FIELD.u('uNorth'), north[0], north[1]);
    gl.uniform1f(FIELD.u('uT'), now / 1000);
    gl.uniform1f(FIELD.u('uDark'), look.dark || 0);
    gl.uniform1f(FIELD.u('uBlue'), look.blue || 0);
    gl.uniform1f(FIELD.u('uRush'), look.rush || 0);
    const A = arrival(now);
    gl.uniform1f(FIELD.u('uArrive'), A ? A.white : 1);
    gl.bindVertexArray(empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  }
  // the floor where something stands, after the opaque room, blended and writing no depth. `o` overrides the room's own
  // floor height, middle and pieces ({ floor, centre, pieces, look })
  function floor(vp, eye, now, o = null) {
    if (!room && !o) return;
    const R = o || room, look = R.look || KIND_LOOK[R.kind] || KIND_LOOK.white;
    const s = now / 1000;
    let n = 0;
    const put = (x, z, r, a) => { if (n >= DISCS || a <= 0.004) return; disc.set([x, z, r, a], n * 4); n++; };
    put(eye[0], eye[2], 1.15, 1);
    for (const [x, z, r] of R.pieces || []) put(x, z, r, 1);
    for (const [x, z, t] of trail) put(x, z, 0.85, 1 - (s - t) / TRAIL_S);
    let m = 0;
    for (const [x, z, t] of rings) { const k = (s - t) / RING_S; ring.set([x, z, 0.25 + (s - t) * RING_V, (1 - k) * (1 - k)], m * 4); m++; }
    gl.useProgram(FLOOR.p);
    gl.uniformMatrix4fv(FLOOR.u('uVP'), false, vp);
    gl.uniform3f(FLOOR.u('uC'), eye[0], 0, eye[2]);
    gl.uniform1f(FLOOR.u('uY'), (R.floor || 0) + 0.001);
    gl.uniform1f(FLOOR.u('uR'), 20);
    gl.uniform4fv(FLOOR.u('uDisc'), disc); gl.uniform1i(FLOOR.u('uDiscN'), n);
    gl.uniform4fv(FLOOR.u('uRing'), ring); gl.uniform1i(FLOOR.u('uRingN'), m);
    gl.uniform1f(FLOOR.u('uDark'), look.dark || 0);
    const A = arrival(now);
    gl.uniform1f(FLOOR.u('uFade'), A ? A.disc : 1);
    gl.uniform1f(FLOOR.u('uGlow'), 0);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, N * 3);
    // the print's scan slice, through the pieces at the height being printed
    if (A && A.print > 0 && A.print < 1 && R.pieces?.length) {
      let k = 0;
      for (const [x, z, r] of R.pieces) { if (k >= DISCS) break; disc.set([x, z, r * 0.75, 1], k * 4); k++; }
      gl.uniform4fv(FLOOR.u('uDisc'), disc); gl.uniform1i(FLOOR.u('uDiscN'), k); gl.uniform1i(FLOOR.u('uRingN'), 0);
      gl.uniform1f(FLOOR.u('uY'), (R.floor || 0) + A.print * PRINT_H);
      gl.uniform1f(FLOOR.u('uGlow'), Math.sin(Math.PI * A.print) * 0.8 + 0.2);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, N * 3);
    }
    gl.disable(gl.BLEND); gl.depthMask(true); gl.depthFunc(gl.LESS);
    gl.bindVertexArray(null);
  }
  // ── THE ARRIVAL ──
  // `arrive(now, eye, vp)` starts it, the body set 2.4 m ahead of where you're looking, facing you. Escape skips it.
  let arr = null;
  const onKey = (e) => { if (arr && e.key === 'Escape') arr.t0 = performance.now() - ARRIVAL_S * 1000 - 1; };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
  function arrive(now, eye, vp, floorY = 0) {
    invert(vp, inv);
    const at = (z) => { const w = inv[11] * z + inv[15]; return [(inv[8] * z + inv[12]) / w, (inv[9] * z + inv[13]) / w, (inv[10] * z + inv[14]) / w]; };
    const a = at(-1), b = at(1);
    let fx = b[0] - a[0], fz = b[2] - a[2];
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    arr = { t0: now, base: [eye[0] + fx * 2.4, floorY, eye[2] + fz * 2.4], toward: [-fx, -fz], right: [fz, -fx] };
  }
  // where the arrival is now, or null once it's over: `white` how far the white has risen, `disc` the floor, `print` the
  // print's sweep, each 0 to 1, and `people` whether the room's people are shown yet
  function arrival(now) {
    if (!arr) return null;
    const t = (now - arr.t0) / 1000;
    if (t >= ARRIVAL_S + 0.5) { arr = null; return null; }
    const c = (x) => Math.max(0, Math.min(1, x));
    return { t, white: c((t - 3) / 2), disc: c((t - 2.6) / 1), print: c((t - 5) / 3), people: t >= 8 };
  }
  // the points, over everything drawn so far, while there are any to see
  function points(vp, eye, now) {
    const A = arrival(now);
    if (!A || A.t > 11.8) return;
    gl.useProgram(PTS.p);
    gl.uniformMatrix4fv(PTS.u('uVP'), false, vp);
    gl.uniform3fv(PTS.u('uBase'), arr.base);
    gl.uniform3fv(PTS.u('uEye'), eye);
    gl.uniform2f(PTS.u('uRight'), arr.right[0], arr.right[1]);
    gl.uniform2f(PTS.u('uToward'), arr.toward[0], arr.toward[1]);
    gl.uniform1f(PTS.u('uT'), A.t);
    gl.uniform1f(PTS.u('uPx'), gl.drawingBufferHeight || 900);
    gl.uniform1f(PTS.u('uOnWhite'), A.white);
    gl.enable(gl.BLEND);
    if (A.white > 0.5) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.bindVertexArray(pvao);
    gl.drawArrays(gl.POINTS, 0, NPTS);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.depthFunc(gl.LESS);
  }
  function dispose() {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
    gl.deleteBuffer(buf); gl.deleteVertexArray(vao); gl.deleteVertexArray(empty); gl.deleteBuffer(pbuf); gl.deleteVertexArray(pvao);
    gl.deleteProgram(FIELD.p); gl.deleteProgram(FLOOR.p); gl.deleteProgram(PTS.p);
  }
  return { setRoom, step, field, floor, arrive, arrival, points, dispose, get arriving() { return !!arr; }, PRINT_H };
}
