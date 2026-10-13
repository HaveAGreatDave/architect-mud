// GLASS 2 · THE CITY'S OWN LIGHTS. What each building round the broadcast's park lights at night,
// as its model does in the flight sim (client/shared/building-lights.js, baked from the models;
// placed by gl/cityscape.js), drawn into the ballpark's float target after the city:
//
//   · points: a lamp, a small disc with a soft edge, or a glow, a falloff nearly gone by its own
//     radius (gl/sprites.js's two profiles), facing the eye; a beacon blinks as blinkLight does,
//     about once a second, never fast enough to flash;
//   · neon: each run a segment at a time, a lit core with a glow round it, facing the eye;
//   · searchlights: a shaft out of the lamp, widening and fading along it, sweeping on its own clock;
//   · plumes: smoke and steam off the stacks, puffs rising and spreading as they fade, laid over
//     what's behind them rather than added, and lit only by the night.
//
// Each is one instanced draw of a buffer written once a venue, worked out in the vertex shader from
// the world's time, so a stopped clock draws the same frame. Nothing gets thinner on the screen than
// MIN_PX pixels: a light that would is drawn that size and dimmer by the area it grew, so a far
// beacon is a dim point rather than a lost one. Depth-tested and not written, each nudged a few feet
// toward the eye off the wall it's on, and all of it through the park's haze (gl/fog.js).

import { HEIGHT_FOG_GLSL } from './fog.js';
import { LIGHT_STRIDE } from './cityscape.js';
import { declareProgram } from './programs.js';

const MIN_PX = 1.5;
// How bright each kind burns in the park's light, against the colour and strength the bake gives
// it: a lamp, a glow, lit air (a still beam's glow, which is light in the air and not a source of
// it), a neon tube's core, a searchlight's shaft at its lamp.
export const CITY_GAIN = Object.freeze({ lamp: 26, glow: 5, air: 0.8, neon: 9, beam: 0.9 });
// A plume: how many puffs at once, how long one lives (s), how high it rises and how wide it ends
// (ft), the way the air takes it, how much of a stack's strength shows, and how much of the city's
// light it catches from below at night (its colour times this, plus the sky's).
export const PLUME = Object.freeze({ puffs: 6, life: 7, rise: 64, size: 10, wind: Object.freeze([0.32, 0, 0.18]), alpha: 0.55, lit: 0.2 });

// A quad's corner, from the vertex's number: (along or across, side).
const CORNER = `
vec2 cornerOf() {
  int c = gl_VertexID;
  return vec2((c == 1 || c == 4 || c == 5) ? 1.0 : 0.0, (c == 2 || c == 3 || c == 5) ? 1.0 : -1.0);
}`;
const COMMON = `
uniform mat4 uVP; uniform vec3 uEye; uniform float uMinW; uniform float uT; uniform float uOn;
uniform float uFogDens; uniform float uFogH;
${HEIGHT_FOG_GLSL}
${CORNER}
float airTo(vec3 P) { return 1.0 - heightFog(uEye.y, P.y, length(uEye - P), uFogDens, uFogH); }`;

const POINT_VS = `#version 300 es
layout(location = 0) in vec4 aA;
layout(location = 1) in vec4 aB;
layout(location = 2) in vec4 aC;
uniform float uLamp; uniform float uGlow; uniform float uAir;
${COMMON}
out vec3 vCol; out vec2 vQ; out float vHard;
void main() {
  vec2 c = cornerOf(); vec2 q = vec2(c.x * 2.0 - 1.0, c.y);
  vec3 P = aA.xyz, toEye = uEye - P; float d = max(length(toEye), 1.0); toEye /= d;
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), toEye) + vec3(1e-5, 0.0, 0.0)), u = cross(toEye, r);
  float R = max(aA.w, d * uMinW), grown = max(aA.w * aA.w / (R * R), 0.15);
  float hard = mod(aB.w, 2.0), lit = mod(floor(aB.w / 4.0), 2.0);
  float blink = aC.y > 0.0 ? aC.x + aC.y * abs(sin(uT * 4.0 + aC.z)) : 1.0;
  vCol = aB.rgb * (lit > 0.5 ? uAir : mix(uGlow, uLamp, hard)) * grown * blink * airTo(P) * uOn;
  vQ = q; vHard = hard;
  gl_Position = uVP * vec4(P + toEye * (R * 1.5 + 2.0) + (r * q.x + u * q.y) * R, 1.0);
}`;
const POINT_FS = `#version 300 es
precision highp float;
in vec3 vCol; in vec2 vQ; in float vHard; out vec4 o;
void main() {
  float d = length(vQ);
  if (d > 1.0) discard;
  float soft = pow(1.0 - d, 1.8), hard = 1.0 - smoothstep(0.72, 1.0, d);
  o = vec4(vCol * mix(soft, hard, vHard), 1.0);
}`;

// A neon segment: from, to, its core's width and its glow's (ft), its colour.
const SEG_VS = `#version 300 es
layout(location = 0) in vec3 aFrom;
layout(location = 1) in vec3 aTo;
layout(location = 2) in float aW;
layout(location = 3) in vec3 aCol;
layout(location = 4) in float aGlow;
uniform float uNeon;
${COMMON}
out vec3 vCol; out float vS; out float vCore;
void main() {
  vec2 c = cornerOf();
  vec3 P = mix(aFrom, aTo, c.x), toEye = uEye - P; float d = max(length(toEye), 1.0); toEye /= d;
  vec3 dir = aTo - aFrom; float L = length(dir); dir = L > 1e-4 ? dir / L : vec3(0.0, 1.0, 0.0);
  vec3 sv = normalize(cross(dir, toEye) + vec3(1e-5, 0.0, 0.0));
  float core = max(aW * 0.5, d * uMinW), H = max(aGlow, core * 2.5);
  vCore = core / H; vS = c.y;
  vCol = aCol * uNeon * max(min(1.0, aW * 0.5 / core), 0.2) * airTo(P) * uOn;
  gl_Position = uVP * vec4(P + toEye * 2.0 + sv * c.y * H, 1.0);
}`;
const SEG_FS = `#version 300 es
precision highp float;
in vec3 vCol; in float vS; in float vCore; out vec4 o;
void main() {
  float s = abs(vS);
  float core = 1.0 - smoothstep(vCore * 0.5, vCore, s), halo = pow(max(0.0, 1.0 - s), 2.0) * 0.22;
  o = vec4(vCol * (core + halo), 1.0);
}`;

// A searchlight: its lamp, the model's right and its door's way on the ground, how it's aimed
// (bearing, sweep, tilt, length), how wide (at the lamp, and how many times that at its end), its
// colour, and its clock (how fast it fades along, its period, its phase).
const BEAM_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aAxes;
layout(location = 2) in vec4 aAim;
layout(location = 3) in vec2 aWide;
layout(location = 4) in vec3 aCol;
layout(location = 5) in vec3 aClock;
uniform float uBeam;
${COMMON}
out vec3 vCol; out vec2 vQ; out float vFall; out float vSpread;
void main() {
  vec2 c = cornerOf();
  float u = fract(uT / max(aClock.y, 0.1) + aClock.z);
  float bear = aAim.x + aAim.y * sin(u * 6.2831853), el = aAim.z, ch = cos(el);
  vec3 right = vec3(aAxes.x, 0.0, aAxes.y), door = vec3(aAxes.z, 0.0, aAxes.w);
  vec3 dir = normalize((right * sin(bear) + door * cos(bear)) * ch + vec3(0.0, sin(el), 0.0));
  // it starts outside its own lamp
  vec3 A = aPos + dir * aWide.x * 1.15, P = A + dir * aAim.w * c.x;
  vec3 toEye = uEye - P; float d = max(length(toEye), 1.0); toEye /= d;
  vec3 sv = normalize(cross(dir, toEye) + vec3(1e-5, 0.0, 0.0));
  float w = aWide.x * mix(1.0, aWide.y, c.x), W = max(w, d * uMinW);
  vQ = c; vFall = aClock.x; vSpread = aWide.y;
  vCol = aCol * uBeam * min(1.0, w / W) * airTo(aPos) * uOn;
  gl_Position = uVP * vec4(P + sv * c.y * W, 1.0);
}`;
const BEAM_FS = `#version 300 es
precision highp float;
in vec3 vCol; in vec2 vQ; in float vFall; in float vSpread; out vec4 o;
void main() {
  // a beam dims as its light spreads over a wider disc and as it travels
  float t = vQ.x, a = pow(max(0.0, 1.0 - t), vFall) * inversesqrt(mix(1.0, vSpread, t));
  o = vec4(vCol * a * exp(-3.0 * vQ.y * vQ.y), 1.0);
}`;

// A plume's puff: the stack's mouth and its strength, its colour and its phase; which puff it is
// comes from the instance.
const PLUME_VS = `#version 300 es
layout(location = 0) in vec4 aA;
layout(location = 1) in vec4 aB;
uniform float uPuffs; uniform float uLife; uniform float uRise; uniform float uSize; uniform vec3 uWind;
uniform vec3 uLit; uniform float uAlpha;
${COMMON}
out vec3 vCol; out vec2 vQ; out float vA;
void main() {
  vec2 c = cornerOf(); vec2 q = vec2(c.x * 2.0 - 1.0, c.y);
  float i = mod(float(gl_InstanceID), uPuffs);
  float u = fract(uT / uLife + aB.w + i / uPuffs);
  vec3 P = aA.xyz + vec3(0.0, uRise * u, 0.0) + uWind * (u * u * uRise);
  vec3 toEye = uEye - P; float d = max(length(toEye), 1.0); toEye /= d;
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), toEye) + vec3(1e-5, 0.0, 0.0)), up = cross(toEye, r);
  float R = max(uSize * (0.3 + 1.4 * u), d * uMinW);
  vA = aA.w * uAlpha * (1.0 - u) * smoothstep(0.0, 0.15, u) * airTo(P);
  vCol = aB.rgb * uLit; vQ = q;
  gl_Position = uVP * vec4(P + (r * q.x + up * q.y) * R, 1.0);
}`;
const PLUME_FS = `#version 300 es
precision highp float;
in vec3 vCol; in vec2 vQ; in float vA; out vec4 o;
void main() {
  float d = length(vQ);
  if (d > 1.0) discard;
  float a = vA * (1.0 - smoothstep(0.25, 1.0, d));
  o = vec4(vCol * a, a);
}`;

for (const [vs, fs] of [[POINT_VS, POINT_FS], [SEG_VS, SEG_FS], [BEAM_VS, BEAM_FS], [PLUME_VS, PLUME_FS]]) declareProgram(vs, fs);

// `prog(vs, fs)` is the ballpark's own builder. set(lights) takes buildCityscape's `lights` (or null
// for none); draw after the city, before the spectacle.
export function createCityLights(gl, prog) {
  const PT = prog(POINT_VS, POINT_FS), SG = prog(SEG_VS, SEG_FS), BM = prog(BEAM_VS, BEAM_FS), PL = prog(PLUME_VS, PLUME_FS);
  // one buffer a kind, its attributes [location, floats, offset in floats], a divisor each
  const layer = (stride, attrs, divisor) => {
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [l, n, off] of attrs) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, stride * 4, off * 4); gl.vertexAttribDivisor(l, divisor); }
    gl.bindVertexArray(null);
    return { vao, buf, n: 0 };
  };
  const pts = layer(LIGHT_STRIDE.pts, [[0, 4, 0], [1, 4, 4], [2, 4, 8]], 1);
  const segs = layer(LIGHT_STRIDE.segs, [[0, 3, 0], [1, 3, 3], [2, 1, 6], [3, 3, 7], [4, 1, 10]], 1);
  const beams = layer(LIGHT_STRIDE.beams, [[0, 3, 0], [1, 4, 3], [2, 4, 7], [3, 2, 11], [4, 3, 13], [5, 3, 16]], 1);
  const plumes = layer(LIGHT_STRIDE.plumes, [[0, 4, 0], [1, 4, 4]], PLUME.puffs);
  const all = [[pts, 'pts'], [segs, 'segs'], [beams, 'beams'], [plumes, 'plumes']];

  function set(L) {
    for (const [d, k] of all) {
      const data = L?.[k] || new Float32Array(0);
      gl.bindBuffer(gl.ARRAY_BUFFER, d.buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      d.n = data.length / LIGHT_STRIDE[k];
    }
  }
  const common = (P, M, minW, t, o) => {
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u('uVP'), false, M.viewProj); gl.uniform3fv(P.u('uEye'), M.eye);
    gl.uniform1f(P.u('uMinW'), minW); gl.uniform1f(P.u('uT'), t); gl.uniform1f(P.u('uOn'), o.on);
    gl.uniform1f(P.u('uFogDens'), o.fogDens || 0); gl.uniform1f(P.u('uFogH'), o.fogH || 160);
  };
  // M: the frame's matrices, eye and lens; h the canvas's height in pixels; t the world's time (s).
  // o: { on (how lit the city is, 0 to 1), fogDens, fogH (the park's air), lit (a plume's light,
  // linear), beams, steam (whether to draw them) }. Returns { draws, tris }.
  function draw(M, h, t, o) {
    let draws = 0, tris = 0;
    if (!(o.on > 0.002)) return { draws, tris };
    // radius a foot of distance for half of MIN_PX
    const minW = (MIN_PX * Math.tan(((M.fov || 40) * Math.PI) / 360)) / Math.max(1, h || 1);
    if (o.steam !== false && plumes.n) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      common(PL, M, minW, t, o);
      gl.uniform1f(PL.u('uPuffs'), PLUME.puffs); gl.uniform1f(PL.u('uLife'), PLUME.life); gl.uniform1f(PL.u('uRise'), PLUME.rise);
      gl.uniform1f(PL.u('uSize'), PLUME.size); gl.uniform3fv(PL.u('uWind'), PLUME.wind); gl.uniform3fv(PL.u('uLit'), o.lit || [0.02, 0.02, 0.022]);
      gl.uniform1f(PL.u('uAlpha'), PLUME.alpha * Math.min(1, o.on * 1.5));
      gl.bindVertexArray(plumes.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, plumes.n * PLUME.puffs);
      draws++; tris += plumes.n * PLUME.puffs * 2;
    }
    gl.blendFunc(gl.ONE, gl.ONE);
    if (o.beams !== false && beams.n) {
      common(BM, M, minW, t, o); gl.uniform1f(BM.u('uBeam'), CITY_GAIN.beam);
      gl.bindVertexArray(beams.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, beams.n);
      draws++; tris += beams.n * 2;
    }
    if (segs.n) {
      common(SG, M, minW, t, o); gl.uniform1f(SG.u('uNeon'), CITY_GAIN.neon);
      gl.bindVertexArray(segs.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, segs.n);
      draws++; tris += segs.n * 2;
    }
    if (pts.n) {
      common(PT, M, minW, t, o); gl.uniform1f(PT.u('uLamp'), CITY_GAIN.lamp); gl.uniform1f(PT.u('uGlow'), CITY_GAIN.glow); gl.uniform1f(PT.u('uAir'), CITY_GAIN.air);
      gl.bindVertexArray(pts.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, pts.n);
      draws++; tris += pts.n * 2;
    }
    return { draws, tris };
  }
  function dispose() { for (const [d] of all) { gl.deleteVertexArray(d.vao); gl.deleteBuffer(d.buf); } }
  return { set, draw, dispose, get counts() { return { pts: pts.n, segs: segs.n, beams: beams.n, plumes: plumes.n }; } };
}
