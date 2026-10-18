// GLASS 2 · A GAME NIGHT ON THE STREETS. The cars and the people round the broadcast's park, as
// diamond/streets.js places them, drawn into the ballpark's float target with the city:
//
//   · cars: one small car instanced over every one, parked at the kerbs or going along its street,
//     its paint lit by the sky and the street, its lamps lit when it's moving;
//   · their lamps: a glow at each headlamp and tail lamp of a car going by, the headlamps seen from
//     in front of it and the tail lamps from behind, added as light;
//   · the people walking to the gates: the crowd's standing figure (ballpark-mesh.js crowdMesh),
//     walking: his legs and arms swing about his hips and shoulders as far as he's come, and he
//     comes into the picture and goes in at the gate a few dots at a time.
//
// Three instanced draws of buffers written once a venue; where each car and walker is, is worked out
// in the vertex shader from the world's clock (diamond/streets.js `along` does the same sum), so a
// stopped clock draws the same street. All of it through the park's haze.

import { CAR_STRIDE, WALKER_STRIDE, STREETS } from '../diamond/streets.js';
import { crowdMesh, CROWD_VERTEX } from './ballpark-mesh.js';
import { HEIGHT_FOG_GLSL } from './fog.js';
import { declareProgram } from './programs.js';

const MIN_PX = 1.5;
// A car's lamps: where they are on it (ft: across, up, along from its middle), and how bright the
// headlamps and the tail lamps burn.
const CAR_LAMPS = Object.freeze({ across: 2.2, up: 2.3, along: 7.4, head: Object.freeze([4.2, 3.7, 3.0]), tail: Object.freeze([2.4, 0.12, 0.06]), r: 0.55 });

const GROUND = -0.3;
const COMMON = `
uniform mat4 uVP; uniform vec3 uEye; uniform float uT; uniform float uFogDens; uniform float uFogH; uniform vec3 uFogCol;
uniform float uFade; uniform float uMinW;
${HEIGHT_FOG_GLSL}
float hazeTo(vec3 P) { return heightFog(uEye.y, P.y, length(uEye - P), uFogDens, uFogH); }
// how far along its way, and how much of it shows: a way of length L at speed v from phase p
vec2 wayAt(float L, float v, float p) {
  if (L <= 0.0 || v <= 0.0) return vec2(0.0, 1.0);
  float s = fract(p + uT * v / L) * L;
  return vec2(s, clamp(min(s, L - s) / uFade, 0.0, 1.0));
}`;
// The light the cars and the people take: the sky from above and the ground from below, the
// street's sodium once the lamps are on, and a little of the city's glow.
const SHADE = `
uniform vec3 uSkyUp; uniform vec3 uSkyDn; uniform vec3 uFill;
vec3 shade(vec3 alb, vec3 N) { return alb * (mix(uSkyDn, uSkyUp, N.y * 0.5 + 0.5) * 1.6 + uFill * (0.55 + 0.45 * max(N.y, 0.0))); }`;

const CAR_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec3 aN; layout(location = 2) in float aPart;
layout(location = 3) in vec4 iA; layout(location = 4) in vec4 iB; layout(location = 5) in vec4 iC;
${COMMON}
out vec3 vPos; out vec3 vN; flat out float vPart; out vec3 vPaint; out float vLit; out float vShow;
void main() {
  vec2 w = wayAt(iB.x, iB.y, iB.z);
  vec2 d = normalize(iA.zw); vec3 fwd = vec3(d.x, 0.0, d.y), right = vec3(-d.y, 0.0, d.x);
  vec3 P = vec3(iA.x + d.x * w.x, ${GROUND.toFixed(1)}, iA.y + d.y * w.x) + right * aPos.x + vec3(0.0, aPos.y, 0.0) + fwd * aPos.z;
  vPos = P; vN = normalize(right * aN.x + vec3(0.0, aN.y, 0.0) + fwd * aN.z); vPart = aPart;
  vPaint = vec3(iB.w, iC.x, iC.y); vLit = iC.z; vShow = w.y;
  gl_Position = uVP * vec4(P, 1.0);
}`;
const CAR_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vN; flat in float vPart; in vec3 vPaint; in float vLit; in float vShow; out vec4 o;
${COMMON}
${SHADE}
float dots(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  if (dots(gl_FragCoord.xy) > vShow) discard;
  vec3 N = normalize(vN), col;
  if (vPart < 0.5) col = shade(vPaint, N) + vPaint * 0.05 * pow(max(N.y, 0.0), 8.0);
  else if (vPart < 1.5) col = shade(vec3(0.012, 0.014, 0.018), N) + uSkyUp * 0.6;
  else if (vPart < 2.5) col = shade(vec3(0.01), N);
  else if (vPart < 3.5) col = mix(vec3(0.05, 0.05, 0.045), vec3(${CAR_LAMPS.head.map((v) => v.toFixed(2)).join(', ')}), vLit);
  else col = mix(vec3(0.03, 0.004, 0.003), vec3(${CAR_LAMPS.tail.map((v) => v.toFixed(2)).join(', ')}), vLit);
  o = vec4(mix(col, uFogCol, hazeTo(vPos)), 1.0);
}`;

// A car's four lamps, as glows: the instance's car is every fourth, the lamp which of the four.
const LAMP_VS = `#version 300 es
layout(location = 3) in vec4 iA; layout(location = 4) in vec4 iB; layout(location = 5) in vec4 iC;
${COMMON}
out vec3 vCol; out vec2 vQ;
void main() {
  int c = gl_VertexID, k = gl_InstanceID % 4;
  vec2 q = vec2((c == 1 || c == 4 || c == 5) ? 1.0 : -1.0, (c == 2 || c == 3 || c == 5) ? 1.0 : -1.0);
  vec2 w = wayAt(iB.x, iB.y, iB.z);
  vec2 d = normalize(iA.zw); vec3 fwd = vec3(d.x, 0.0, d.y), right = vec3(-d.y, 0.0, d.x);
  float front = k < 2 ? 1.0 : -1.0, side = (k == 0 || k == 2) ? -1.0 : 1.0;
  vec3 P = vec3(iA.x + d.x * w.x, ${GROUND.toFixed(1)} + ${CAR_LAMPS.up.toFixed(2)}, iA.y + d.y * w.x) + fwd * front * ${CAR_LAMPS.along.toFixed(2)} + right * side * ${CAR_LAMPS.across.toFixed(2)};
  vec3 toEye = uEye - P; float de = max(length(toEye), 1.0); toEye /= de;
  // a headlamp is seen from in front, a tail lamp from behind
  float face = smoothstep(-0.15, 0.55, front * dot(toEye, fwd));
  vec3 lamp = front > 0.0 ? vec3(${CAR_LAMPS.head.map((v) => v.toFixed(2)).join(', ')}) : vec3(${CAR_LAMPS.tail.map((v) => v.toFixed(2)).join(', ')});
  float R = max(${CAR_LAMPS.r.toFixed(2)}, de * uMinW), grown = max(${(CAR_LAMPS.r * CAR_LAMPS.r).toFixed(4)} / (R * R), 0.12);
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), toEye) + vec3(1e-5, 0.0, 0.0)), u = cross(toEye, r);
  vCol = lamp * iC.z * face * w.y * grown * (1.0 - hazeTo(P)); vQ = q;
  gl_Position = uVP * vec4(P + toEye * 1.5 + (r * q.x + u * q.y) * R * 2.2, 1.0);
}`;
const LAMP_FS = `#version 300 es
precision highp float;
in vec3 vCol; in vec2 vQ; out vec4 o;
void main() { float d = length(vQ); if (d > 1.0) discard; o = vec4(vCol * pow(1.0 - d, 2.2), 1.0); }`;

// A walker: the standing figure, turned to his way and walking along it.
const WALK_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec3 aN; layout(location = 2) in float aPart;
layout(location = 3) in vec4 iA; layout(location = 4) in vec4 iB; layout(location = 5) in vec4 iC;
${COMMON}
out vec3 vPos; out vec3 vN; flat out float vPart; out vec3 vShirt; out float vSkin; out float vShow; out float vSeed;
vec3 swing(vec3 p, vec3 n, float y0, float a, inout vec3 nn) {
  float c = cos(a), s = sin(a), y = p.y - y0;
  nn = vec3(n.x, c * n.y - s * n.z, s * n.y + c * n.z);
  return vec3(p.x, y0 + c * y - s * p.z, s * y + c * p.z);
}
void main() {
  vec2 w = wayAt(iB.x, iB.y, iB.z);
  // a stride of 2.6 ft, a step each foot
  float ph = w.x / 5.2 * 6.2831853 + iB.z * 40.0, sw = sin(ph), side = sign(aPos.x);
  vec3 p = aPos, n = aN, nn = aN;
  // which limb a vertex is on comes from its part (ballpark-mesh.js CROWD_PART): a leg or a shoe swings
  // about the hip, a sleeve or a hand about the shoulder, the other way
  bool leg = (aPart > 2.1 && aPart < 2.4) || (aPart > 3.1 && aPart < 3.4), arm = (aPart > 1.1 && aPart < 1.4) || (aPart > 0.1 && aPart < 0.4);
  if (leg) { p = swing(p, n, 3.15, sw * 0.42 * side, nn); n = nn; }
  else if (arm) { p = swing(p, n, 4.68, -sw * 0.34 * side, nn); n = nn; }
  p.y += abs(cos(ph)) * 0.1;
  p *= iC.w;
  vec2 d = normalize(iA.zw); vec3 fwd = vec3(d.x, 0.0, d.y), right = vec3(d.y, 0.0, -d.x);
  vec3 P = vec3(iA.x + d.x * w.x, ${GROUND.toFixed(1)}, iA.y + d.y * w.x) + right * p.x + vec3(0.0, p.y, 0.0) + fwd * p.z;
  vPos = P; vN = normalize(right * n.x + vec3(0.0, n.y, 0.0) + fwd * n.z); vPart = aPart;
  vShirt = vec3(iB.w, iC.x, iC.y); vSkin = iC.z; vShow = w.y; vSeed = iB.z;
  gl_Position = uVP * vec4(P, 1.0);
}`;
const WALK_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vN; flat in float vPart; in vec3 vShirt; in float vSkin; in float vShow; in float vSeed; out vec4 o;
${COMMON}
${SHADE}
float dots(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  if (dots(gl_FragCoord.xy) > vShow) discard;
  vec3 skin = mix(vec3(0.62, 0.42, 0.3), vec3(0.11, 0.06, 0.04), vSkin);
  vec3 pants = mix(vec3(0.03, 0.04, 0.07), vec3(0.12, 0.10, 0.07), fract(vSeed * 7.13));
  vec3 alb = vPart < 0.5 ? skin : vPart < 1.5 ? vShirt : vPart < 2.5 ? pants : vec3(0.02, 0.016, 0.012);
  o = vec4(mix(shade(alb, normalize(vN)), uFogCol, hazeTo(vPos)), 1.0);
}`;

for (const [vs, fs] of [[CAR_VS, CAR_FS], [LAMP_VS, LAMP_FS], [WALK_VS, WALK_FS]]) declareProgram(vs, fs);

// The car, 7 floats a vertex: position (ft: across, up, along from its middle), normal, part (0 the
// paint, 1 the glass, 2 the tyres, 3 a headlamp, 4 a tail lamp).
function carMesh() {
  const out = [];
  const face = (a, b, c, d, n, part) => { for (const p of [a, b, c, a, c, d]) out.push(p[0], p[1], p[2], n[0], n[1], n[2], part); };
  const box = (x0, x1, y0, y1, z0, z1, part, top = true) => {
    face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], part);
    face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], part);
    face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], part);
    face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], part);
    if (top) face([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], part);
  };
  box(-3.0, 3.0, 0.75, 2.9, -7.3, 7.3, 0);
  box(-2.65, 2.65, 2.9, 4.5, -3.8, 2.3, 1, false);
  face([-2.65, 4.5, 2.3], [2.65, 4.5, 2.3], [2.65, 4.5, -3.8], [-2.65, 4.5, -3.8], [0, 1, 0], 0);
  for (const x of [-3.05, 2.25]) for (const z of [-4.9, 3.5]) box(x, x + 0.8, 0, 1.45, z, z + 1.4, 2);
  for (const s of [-1, 1]) {
    face([s * 2.65, 2.0, 7.32], [s * 1.75, 2.0, 7.32], [s * 1.75, 2.55, 7.32], [s * 2.65, 2.55, 7.32], [0, 0, 1], 3);
    face([s * 1.6, 2.2, -7.32], [s * 2.7, 2.2, -7.32], [s * 2.7, 2.75, -7.32], [s * 1.6, 2.75, -7.32], [0, 0, -1], 4);
  }
  return new Float32Array(out);
}

// `prog(vs, fs)` is the ballpark's own builder. set(life) takes diamond/streets.js streetLife's
// { cars, walkers } (or null); draw with the city.
export function createStreetLife(gl, prog) {
  const C = prog(CAR_VS, CAR_FS), L = prog(LAMP_VS, LAMP_FS), W = prog(WALK_VS, WALK_FS);
  const mesh = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return { buf: b, n: data.length / 7 }; };
  const car = mesh(carMesh()), man = mesh(crowdMesh('stand', { far: true }));
  if (CROWD_VERTEX !== 7) throw new Error('streetlife: the crowd figure is no longer 7 floats a vertex');
  const carInst = gl.createBuffer(), walkInst = gl.createBuffer();
  // a VAO: a mesh's position, normal and part, and an instance buffer's three vec4s, each every `div`
  // instances
  const vaoOf = (m, inst, stride, div) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    if (m) {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
      for (const [l, n, off] of [[0, 3, 0], [1, 3, 12], [2, 1, 24]]) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 28, off); }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    for (const [l, off] of [[3, 0], [4, 16], [5, 32]]) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, stride * 4, off); gl.vertexAttribDivisor(l, div); }
    gl.bindVertexArray(null);
    return vao;
  };
  const carVao = vaoOf(car, carInst, CAR_STRIDE, 1), lampVao = vaoOf(null, carInst, CAR_STRIDE, 4), walkVao = vaoOf(man, walkInst, WALKER_STRIDE, 1);
  let cars = 0, walkers = 0;
  function set(life) {
    const c = life?.cars || new Float32Array(0), w = life?.walkers || new Float32Array(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, carInst); gl.bufferData(gl.ARRAY_BUFFER, c, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, walkInst); gl.bufferData(gl.ARRAY_BUFFER, w, gl.STATIC_DRAW);
    cars = c.length / CAR_STRIDE; walkers = w.length / WALKER_STRIDE;
  }
  const common = (P, M, h, t, o) => {
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u('uVP'), false, M.viewProj); gl.uniform3fv(P.u('uEye'), M.eye); gl.uniform1f(P.u('uT'), t);
    gl.uniform1f(P.u('uFogDens'), o.fogDens || 0); gl.uniform1f(P.u('uFogH'), o.fogH || 160); gl.uniform3fv(P.u('uFogCol'), o.fogCol || [0, 0, 0]);
    gl.uniform1f(P.u('uFade'), STREETS.fade);
    gl.uniform1f(P.u('uMinW'), (MIN_PX * Math.tan(((M.fov || 40) * Math.PI) / 360)) / Math.max(1, h || 1));
  };
  const shade = (P, o) => { gl.uniform3fv(P.u('uSkyUp'), o.up); gl.uniform3fv(P.u('uSkyDn'), o.dn); gl.uniform3fv(P.u('uFill'), o.fill); };
  // M: the frame's matrices, eye and lens; h the canvas's height; t the world's time (s). o: { up,
  // dn (the sky's ambient), fill (the street's light, linear), fogDens, fogH, fogCol, lamps (how lit
  // the cars' lamps are, 0 to 1) }. Opaque first (`draw`), then the lamps added (`drawLamps`).
  // Each returns { draws, tris }.
  function draw(M, h, t, o) {
    let draws = 0, tris = 0;
    if (cars) {
      common(C, M, h, t, o); shade(C, o);
      gl.bindVertexArray(carVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, car.n, cars);
      draws++; tris += (car.n / 3) * cars;
    }
    if (walkers) {
      common(W, M, h, t, o); shade(W, o);
      gl.bindVertexArray(walkVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, man.n, walkers);
      draws++; tris += (man.n / 3) * walkers;
    }
    return { draws, tris };
  }
  function drawLamps(M, h, t, o) {
    if (!cars || !(o.lamps > 0.01)) return { draws: 0, tris: 0 };
    common(L, M, h, t, o);
    gl.bindVertexArray(lampVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, cars * 4);
    return { draws: 1, tris: cars * 8 };
  }
  function dispose() {
    for (const v of [carVao, lampVao, walkVao]) gl.deleteVertexArray(v);
    for (const b of [car.buf, man.buf, carInst, walkInst]) gl.deleteBuffer(b);
  }
  return { set, draw, drawLamps, dispose, get counts() { return { cars, walkers }; } };
}
