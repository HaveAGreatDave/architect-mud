// GLASS 2 · THE ESTABLISHING SHOT. The fly-in before a game for a view that has no outside of its
// own: Rinkside draws the ice and the bowl and nothing past them, so before the drop this comes in
// high over the city and down onto the building the game is in, on a canvas
// of its own over the rink, and dissolves into the rink at the end (gameday-rink.js arrive).
//
// The city is the one the Grandstand draws round the Coliseum: the set composed round the venue's
// site (client/shared/city-set.js) and built by gl/cityscape.js from every building's baked shape.
// The venue's own tiles are drawn from their shapes too, where the map has them, so the building on
// screen is the one in the map, with a gilt goose on its gable. The look is plain night: a sky over
// the city's glow, the windows and the sodium pools, and the buildings' own lamps as points. No
// shadows, no bloom, no players: twelve seconds, then it's gone and its context with it.
//
// It names no venue: the site, the skyline, the art direction and the venue's own name come in with
// the venue (venue.js), and the shot is placed off the site's frame. Returns null with no WebGL2.

import { composeSet, mapAxes, SET_TILE } from '../../../../shared/city-set.js';
import { buildCityscape, cityShape, FACADE_GLSL, STREET_GLSL, LIGHT_STRIDE } from './cityscape.js';
import { STRIDE, MAT, createBatch, quad } from './ballpark-mesh.js';
import { shotMatrices, inv4, approachShot, shotAt } from '../diamond/camera.js';

// how long the shot is (s), and when in it the rink starts to show through
export const FLY = Object.freeze({ dur: 12, fade: 1.3 });
// the shot, round the venue's middle: in from `far` feet out and `height` up, swung round from the
// door's side, down to `end` (feet north of the middle and up) looking at its roof
const PATH = Object.freeze({ far: 900, height: 540, swing: 0.85, drop: 1.25, fov: 40, end: { north: 330, up: 150, look: 40, fov: 42 } });

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aCol;
layout(location = 4) in float aMat;
uniform mat4 uVP;
out vec3 vPos; out vec3 vNrm; out vec2 vUv; out vec3 vCol; flat out int vMat;
void main() { vPos = aPos; vNrm = aNrm; vUv = aUv; vCol = aCol; vMat = int(aMat + 0.5); gl_Position = uVP * vec4(aPos, 1.0); }`;

// The night's light, the city's windows and streets, and the air between, in linear light; the
// curve and the encode at the end.
const FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNrm; in vec2 vUv; in vec3 vCol; flat in int vMat;
uniform sampler2D uGrass;
uniform vec3 uEye; uniform vec3 uSkyUp; uniform vec3 uSkyDn; uniform vec3 uMoon; uniform vec3 uMoonDir;
uniform vec3 uFog; uniform float uFogD; uniform float uWin; uniform vec3 uVenue;
out vec4 o;
${FACADE_GLSL}
${STREET_GLSL}
vec3 curve(vec3 c) { c = max(c, 0.0); c = c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14); return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
float haze(vec3 p) { return 1.0 - exp(-length(p - uEye) * uFogD); }
void main() {
  if (vMat == ${MAT.POOL}) {
    // a pool of lamplight, added over the ground (gl/cityscape.js: 26 ft up, 38 ft round)
    vec2 q = vUv * 2.0 - 1.0; float d2 = dot(q, q), h = 26.0 / 38.0;
    float E = pow(h * h / (d2 + h * h), 1.5) * (1.0 - smoothstep(0.6, 1.0, sqrt(d2)));
    o = vec4(vCol * E * 0.08 * (1.0 - haze(vPos)), 1.0);
    return;
  }
  vec3 N = normalize(vNrm), alb = vCol, emis = vec3(0.0); float rough = 0.8, f0s = 0.04, metal = 0.0;
  if (vMat == ${MAT.EMISSIVE}) { o = vec4(curve(mix(vCol * 0.6, uFog, haze(vPos))), 1.0); return; }
  if (vMat == ${MAT.FACADE}) { facade(alb, rough, f0s, emis, metal); emis *= uWin; }
  else if (vMat == ${MAT.STREET}) street(alb, rough, f0s);
  vec3 amb = mix(uSkyDn, uSkyUp, N.y * 0.5 + 0.5);
  vec3 c = alb * (amb + uMoon * max(dot(N, uMoonDir), 0.0)) + emis;
  // the sodium's wash on the street-level walls, warm and low
  c += alb * vec3(0.05, 0.022, 0.006) * (1.0 - smoothstep(0.0, 60.0, vPos.y));
  // the venue under its floods: its walls warm from the forecourt's lamps, its roof catching them,
  // so the eye goes to it before anything else in the frame (uVenue: its middle and its reach)
  float vn = 1.0 - smoothstep(uVenue.z * 0.85, uVenue.z * 1.5, length(vPos.xz - uVenue.xy));
  c += max(alb, vec3(0.05)) * vec3(2.6, 1.7, 0.9) * vn * mix(1.0, 0.55, max(N.y, 0.0));
  o = vec4(curve(mix(c, uFog, haze(vPos))), 1.0);
}`;

// The sky: the city's glow low on the horizon, dark blue above it.
const SKY_VS = `#version 300 es
out vec2 vNdc;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; vNdc = p; gl_Position = vec4(p, 0.9999, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc; uniform mat4 uInv; uniform vec3 uEye; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGlow;
out vec4 o;
void main() {
  vec4 w = uInv * vec4(vNdc, 1.0, 1.0); vec3 d = normalize(w.xyz / w.w - uEye);
  float e = clamp(d.y, -0.2, 1.0);
  vec3 c = mix(uHor, uZen, smoothstep(0.0, 0.55, e)) + uGlow * exp(-max(e, 0.0) * 9.0);
  c = c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14);
  o = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

// The buildings' own lamps (client/shared/building-lights.js points), and the goose, as soft
// points added over the frame.
const PT_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in float aR; layout(location = 2) in vec3 aCol;
uniform mat4 uVP; uniform float uPx;
out vec3 vCol;
void main() { gl_Position = uVP * vec4(aPos, 1.0); gl_PointSize = clamp(aR * uPx / max(gl_Position.w, 1.0), 1.5, 48.0); vCol = aCol; }`;
const PT_FS = `#version 300 es
precision highp float;
in vec3 vCol; out vec4 o;
void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0) discard; float k = exp(-d * 4.0); vec3 c = vCol * k; o = vec4(c / (1.0 + c), 1.0); }`;

function program(gl, vs, fs) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  const u = new Map();
  return { p, u: (n) => { if (!u.has(n)) u.set(n, gl.getUniformLocation(p, n)); return u.get(n); } };
}

// The set and its geometry for a venue, with the venue's own tiles drawn from their shapes and the
// goose on the tallest of them. Pure (no GL), so a gate can build it in node.
export function buildApproach(venue) {
  const site = venue?.site;
  if (!site || !venue.skyline) return null;
  const T = SET_TILE, { EX, EN } = mapAxes(site.bearing), sx = Number(site.x), sy = Number(site.y);
  const blk = site.block || { x0: Math.floor(sx), x1: Math.floor(sx), y0: Math.floor(sy), y1: Math.floor(sy) };
  const t2p = (x, y) => [EX[0] * (x - sx) * T - EN[0] * (y - sy) * T, 0, EX[2] * (x - sx) * T - EN[2] * (y - sy) * T];
  // the venue's outline is its block: the city stands round it at the map's own size
  const outline = [[blk.x0, blk.y0], [blk.x1 + 1, blk.y0], [blk.x1 + 1, blk.y1 + 1], [blk.x0, blk.y1 + 1]].map(([x, y]) => t2p(x, y));
  const set = composeSet({ site, skyline: venue.skyline, outline, art: venue.city || null });
  const own = (venue.skyline.buildings || []).filter((b) => b.x >= blk.x0 && b.x <= blk.x1 && b.y >= blk.y0 && b.y <= blk.y1);
  for (const b of own) set.placed.push({ b, at: set.warp(set.t2p(b.x + 0.5, b.y + 0.5)) });
  const city = buildCityscape(set, { art: venue.city || null, outline });
  // the top of the venue, where its roof is highest: the goose stands there, in gold leaf
  let top = 0, topAt = [0, 0, 0];
  for (const b of own) {
    const sh = cityShape(b); if (!sh) continue;
    for (const s of sh.segs) if (s.z1 * T > top) { top = s.z1 * T; const at = set.warp(set.t2p(b.x + 0.5, b.y + 0.5)); topAt = at; }
  }
  const goose = { at: [topAt[0], top + 6, topAt[2]], top };
  // the venue's own forecourt, washed warm by the floods over its doors
  const wash = createBatch(64);
  const c = set.t2p((blk.x0 + blk.x1 + 1) / 2, blk.y0 - 0.25), R = T * 1.4;
  quad(wash, [c[0] - R, -0.1, c[2] - R], [c[0] + R, -0.1, c[2] - R], [c[0] + R, -0.1, c[2] + R], [c[0] - R, -0.1, c[2] + R], [0, 1, 0], [5, 3.2, 1.6], MAT.POOL);
  city.glow.set('wash', wash);
  // how far the venue's floods reach from its middle: its block's half diagonal
  const reach = Math.hypot(blk.x1 - blk.x0 + 1, blk.y1 - blk.y0 + 1) * T / 2;
  return { set, city, goose, EN, EX, top: Math.max(top, 40), reach };
}

// The shot for a built approach: approachShot round the venue's middle, down to the door's side.
export function approachPath(A, t0 = 0) {
  const N = A.EN, e = PATH.end;
  const end = { eye: [N[0] * e.north, e.up, N[2] * e.north], at: [0, Math.min(A.top, e.look), 0], fov: e.fov };
  return approachShot(end, t0, { dur: FLY.dur, far: PATH.far, height: PATH.height, swing: PATH.swing, drop: PATH.drop, fov: PATH.fov, mid: [0, A.top * 0.5, 0] });
}

export function createApproachRenderer(canvas, venue) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false });
  if (!gl) return null;
  const A = buildApproach(venue);
  if (!A) return null;
  let P, SKY, PT;
  try { P = program(gl, VS, FS); SKY = program(gl, SKY_VS, SKY_FS); PT = program(gl, PT_VS, PT_FS); } catch (err) { console.warn('[approach] shader:', err && err.message); return null; }

  // one buffer for everything opaque, one for the glow, one for the points
  const upload = (batches) => {
    let n = 0; for (const b of batches) n += b.n;
    const data = new Float32Array(n * STRIDE); let o = 0;
    for (const b of batches) { data.set(b.data.subarray(0, b.n * STRIDE), o); o += b.n * STRIDE; }
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const F = 4 * STRIDE;
    [[0, 3, 0], [1, 3, 3], [2, 2, 6], [3, 3, 8], [4, 1, 11]].forEach(([l, s, off]) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, s, gl.FLOAT, false, F, off * 4); });
    gl.bindVertexArray(null);
    return { vao, buf, n };
  };
  // the Curtain's walls: dark, with their lit top edge
  const wall = createBatch(256);
  for (const w of A.city.curtain || []) {
    const a = w.a, b = w.b, h = w.h;
    quad(wall, [a[0], -0.3, a[2]], [b[0], -0.3, b[2]], [b[0], h, b[2]], [a[0], h, a[2]], [0, 0, 1], [0.02, 0.03, 0.035], MAT.MATTE);
    quad(wall, [a[0], h - 4, a[2]], [b[0], h - 4, b[2]], [b[0], h, b[2]], [a[0], h, a[2]], [0, 0, 1], [0.4, 2.2, 2.6], MAT.EMISSIVE);
  }
  const opaque = upload([...A.city.opaque.values(), wall]);
  const glow = upload([...A.city.glow.values()]);
  // the lamps: position, radius, colour (building-lights.js points), and the goose
  const LP = A.city.lights.pts, n = LP.length / LIGHT_STRIDE.pts, pts = new Float32Array((n + 1) * 7);
  for (let i = 0; i < n; i++) { const r = i * LIGHT_STRIDE.pts; pts.set([LP[r], LP[r + 1], LP[r + 2], Math.max(2, LP[r + 3]) * 3, LP[r + 4] * 1.6, LP[r + 5] * 1.6, LP[r + 6] * 1.6], i * 7); }
  pts.set([...A.goose.at, 26, 6, 4.2, 1.2], n * 7);
  const ptVao = gl.createVertexArray(), ptBuf = gl.createBuffer();
  gl.bindVertexArray(ptVao); gl.bindBuffer(gl.ARRAY_BUFFER, ptBuf); gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 28, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 28, 16);
  gl.bindVertexArray(null);
  const nPts = n + 1;
  // the street shader's noise
  const grass = gl.createTexture();
  { const N = 64, px = new Uint8Array(N * N * 4); let s = 0x2545f491; for (let i = 0; i < px.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; px[i] = s & 255; }
    gl.bindTexture(gl.TEXTURE_2D, grass); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); }
  // the city's glow (its art direction's), low in the sky and in the haze over it
  const glowCol = (venue.city?.glow || [255, 96, 168]).map((c) => ((c / 255) ** 2.2) * 0.12);
  const fogCol = [0.03 + glowCol[0] * 0.25, 0.028 + glowCol[1] * 0.25, 0.042 + glowCol[2] * 0.25];
  const path = approachPath(A, 0);
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });

  // the frame `t` seconds into the shot
  function render(t) {
    if (lost) return false;
    const w = canvas.width, h = canvas.height;
    if (!(w > 0 && h > 0)) return false;
    const shot = shotAt(path, t), M = shotMatrices({ ...shot, near: 2 }, w / h);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // the sky
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(SKY.p);
    gl.uniformMatrix4fv(SKY.u('uInv'), false, new Float32Array(inv4(M.viewProj)));
    gl.uniform3fv(SKY.u('uEye'), M.eye); gl.uniform3f(SKY.u('uZen'), 0.006, 0.009, 0.024); gl.uniform3fv(SKY.u('uHor'), fogCol); gl.uniform3fv(SKY.u('uGlow'), glowCol);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // the city
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u('uVP'), false, new Float32Array(M.viewProj));
    gl.uniform3fv(P.u('uEye'), M.eye);
    gl.uniform3f(P.u('uSkyUp'), 0.03, 0.034, 0.05); gl.uniform3f(P.u('uSkyDn'), 0.01, 0.009, 0.01);
    gl.uniform3f(P.u('uMoon'), 0.035, 0.04, 0.055); gl.uniform3fv(P.u('uMoonDir'), [0.29, 0.86, 0.42]);
    gl.uniform3fv(P.u('uFog'), fogCol); gl.uniform1f(P.u('uFogD'), 0.00028); gl.uniform1f(P.u('uWin'), 2.2);
    gl.uniform3f(P.u('uVenue'), 0, 0, A.reach);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, grass); gl.uniform1i(P.u('uGrass'), 0);
    gl.bindVertexArray(opaque.vao); gl.drawArrays(gl.TRIANGLES, 0, opaque.n);
    // the pools and the points, added over it
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
    gl.bindVertexArray(glow.vao); gl.drawArrays(gl.TRIANGLES, 0, glow.n);
    gl.useProgram(PT.p);
    gl.uniformMatrix4fv(PT.u('uVP'), false, new Float32Array(M.viewProj));
    gl.uniform1f(PT.u('uPx'), h / (2 * Math.tan((M.fov * Math.PI) / 360)));
    gl.bindVertexArray(ptVao); gl.drawArrays(gl.POINTS, 0, nPts);
    gl.bindVertexArray(null); gl.depthMask(true); gl.disable(gl.BLEND);
    return true;
  }
  function dispose() {
    for (const d of [opaque, glow]) { gl.deleteVertexArray(d.vao); gl.deleteBuffer(d.buf); }
    gl.deleteVertexArray(ptVao); gl.deleteBuffer(ptBuf); gl.deleteTexture(grass);
    for (const x of [P, SKY, PT]) gl.deleteProgram(x.p);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return { render, dispose, get stats() { return { ...A.city.stats, points: nPts }; }, get lost() { return lost; }, path };
}
