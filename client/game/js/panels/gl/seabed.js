// SEABED — the underwater half of the world pass (plugins/submersible).
//
// Three draws, all fed by seabed-scene.js through FLOOR_STATE:
//
//   1. THE WATER ITSELF — a screen-filling triangle at the far plane, depth-tested so it only
//      fills what nothing else covered. Lighter toward the surface, dark below, with slow shafts of
//      light. It replaces the sky, which from under the sea you cannot see except through Snell's
//      window (water.js draws that on the underside of the surface).
//   2. THE BOTTOM — the seabed mesh, its rocks, weed and wrecks: flat-shaded triangles, lit from
//      above with a caustic pattern that fades with depth, and extinguished per channel toward
//      the water colour with distance (red goes first, then green, then blue — the same curve
//      water.js uses for the surface from below).
//   3. WHAT IS IN THE WATER — bubbles off the Drake's engine and particles hanging in the water,
//      as point sprites.
//
// ⚠ NO BACKTICKS INSIDE THE SHADERS: they are template literals, and a backticked identifier in a
// comment ends the string.

import { SEABED_EXT, SEABED_FADE, WATER_UP_SPAN } from '../seabed-scene.js';
import { viewProjMatrix, mat4f, eyePos } from './camera.js';
import { invert4 } from './cloudvol.js';
import { makeVertexStream } from './stream.js';
import { linearOut, applyLinOut } from './colour.js';

// ⚠ THE WATER'S COLOUR IS A FUNCTION OF THE VIEW RAY, AND EVERY DRAW HERE USES THIS ONE. The
// backdrop is this colour; the floor, its props and the points all fog toward it along their own
// ray. It used to be a screen-height gradient behind a floor that fogged to one flat colour, which
// near the horizon was nearly twice as bright as what lay behind it, so the far edge of the floor
// stood out as a line: the land stopping in front of you. JS twin: waterAlong in seabed-scene.js.
const WATER_ALONG = `
vec3 waterAlong(vec3 w, float dz) {
  float up = clamp(dz / ${WATER_UP_SPAN.toFixed(3)}, -1.0, 1.0);
  return w * (0.55 + 0.45 * up + 0.35 * max(up, 0.0));
}`;
// ⚠ HER LAMPS, ONE DEFINITION FOR EVERY DRAW. A cone off the Drake's nose (windshield.js subLamp):
// a tight core and a wider spill, falling off with distance and with the water the light crosses on
// the way out. lampAt is the light arriving at a point; lampBeam is what the water along a view ray
// scatters back toward the eye, which is the shaft you see hanging in front of her. Units are tiles.
const LAMP = `
uniform vec3 uLampP;
uniform vec3 uLampD;
uniform float uLampOn;
const vec3 LAMP_COL = vec3(1.0, 0.95, 0.84);
float lampAt(vec3 p) {
  vec3 L = p - uLampP;
  float d = max(length(L), 1e-3);
  float c = dot(L / d, uLampD);
  float cone = smoothstep(0.82, 0.95, c) + 0.35 * smoothstep(0.55, 0.86, c);
  return uLampOn * cone * exp(-d * 0.16) / (1.0 + d * d * 0.05);
}
vec3 lampBeam(vec3 eye, vec3 dir, float dmax) {
  if (uLampOn < 0.5) return vec3(0.0);
  float m = min(dmax, 16.0), st = m / 20.0, s = 0.0;
  for (int i = 0; i < 20; i++) {
    float t = (float(i) + 0.5) * st;
    s += lampAt(eye + dir * t) * exp(-t * 0.22);
  }
  return vec3(0.5, 0.72, 0.7) * s * st * 0.09;
}`;
const f3 = (v) => `vec3(${v.map((q) => q.toFixed(4)).join(', ')})`;

const BG_VERT = `#version 300 es
out vec2 vNdc;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vNdc = p * 2.0 - 1.0;
  gl_Position = vec4(vNdc, 0.99999, 1.0);
}`;
const BG_FRAG = linearOut(`#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uWater;
uniform float uT;
uniform float uLit;
out vec4 frag;
${WATER_ALONG}
${LAMP}
void main() {
  // The ray through this pixel, from the triangle's own NDC, so it holds at any target size.
  vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0); a /= a.w;
  vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0); b /= b.w;
  vec3 dir = normalize(b.xyz - a.xyz);
  vec3 col = waterAlong(uWater, dir.z);
  // Shafts: slow bands round the compass, only looking up, only with light to make them. Whole
  // numbers of bands a turn, so there is no seam where the bearing wraps.
  float az = atan(dir.y, dir.x);
  float s = sin(az * 10.0 + uT * 0.25) * 0.5 + sin(az * 26.0 - uT * 0.4) * 0.3 + sin(az * 5.0 + uT * 0.1) * 0.2;
  col += vec3(0.10, 0.18, 0.18) * pow(max(s, 0.0), 3.0) * clamp(dir.z / ${WATER_UP_SPAN.toFixed(3)}, 0.0, 1.0) * uLit;
  col += lampBeam(a.xyz, dir, 16.0);
  frag = vec4(col, 1.0);
}`, 'frag');

const MESH_VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aCol;
uniform mat4 uViewProj;
out vec3 vW;
out vec3 vC;
void main() {
  vW = aPos; vC = aCol;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;
const MESH_FRAG = linearOut(`#version 300 es
precision highp float;
in vec3 vW;
in vec3 vC;
uniform vec3 uEye;
uniform vec3 uWater;
uniform float uExt;
uniform float uT;
uniform float uLit;
out vec4 frag;
${WATER_ALONG}
${LAMP}
void main() {
  vec3 ray = vW - uEye;
  float d = length(ray);
  float dep = max(0.0, -vW.z);
  // Caustics: the surface focusing the light into moving bright lines on the bottom. Strong in the
  // shallows, gone a few tiles down.
  vec2 p = vW.xy * 3.1;
  float c = sin(p.x * 1.7 + uT * 0.45) + sin(p.y * 1.9 - uT * 0.38) + sin((p.x + p.y) * 1.3 + uT * 0.26);   // slow: the surface above moves at a walking pace
  c = pow(max(0.0, c / 3.0), 3.0) * exp(-dep * 0.9) * uLit;
  vec3 col = vC * (0.35 + 0.65 * exp(-dep * 0.4) * uLit) + c * vec3(0.5, 0.75, 0.7);
  // Her lamps: the light that reaches this face, on the face's own normal, at full colour. It is
  // the one light down here that gives the floor back its reds.
  if (uLampOn > 0.5) {
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
    vec3 toL = normalize(uLampP - vW);
    float ndl = 0.25 + 0.75 * abs(dot(n, toL));
    col += vC * LAMP_COL * lampAt(vW) * ndl * 3.4;
  }
  // Into the water along this ray: the same colour the backdrop has right behind it.
  vec3 fog = waterAlong(uWater, ray.z / max(d, 1e-4));
  vec3 trans = exp(-d * uExt * ${f3(SEABED_EXT)});
  // The patch ends at SEABED_R tiles: dissolve into the water well before it, so no edge is ever seen.
  float edge = smoothstep(${SEABED_FADE[0].toFixed(2)}, ${SEABED_FADE[1].toFixed(2)}, length(ray.xy));
  frag = vec4(mix(col * trans + fog * (1.0 - trans), fog, edge) + lampBeam(uEye, ray / max(d, 1e-4), d), 1.0);
}`, 'frag');

const PT_VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aMeta;
uniform mat4 uViewProj;
uniform float uFocal;
uniform vec3 uEye;
out float vA;
out float vKind;
out float vDist;
out float vDz;
out float vLamp;
${LAMP}
void main() {
  vec4 c = uViewProj * vec4(aPos, 1.0);
  gl_Position = c;
  gl_PointSize = clamp(aMeta.x * uFocal / max(c.w, 0.01), 1.0, 48.0);
  vA = aMeta.y; vKind = aMeta.z; vDist = c.w;
  vec3 ray = aPos - uEye;
  vDz = ray.z / max(length(ray), 1e-4);
  vLamp = lampAt(aPos);
}`;
const PT_FRAG = linearOut(`#version 300 es
precision highp float;
in float vA;
in float vKind;
in float vDist;
in float vDz;
in float vLamp;
uniform vec3 uWater;
uniform float uExt;
uniform float uSub;
out vec4 frag;
${WATER_ALONG}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float a;
  vec3 col;
  if (vKind < 0.5) {
    // A bubble is a bright rim round a clear middle, with a highlight up and to the left.
    a = smoothstep(0.55, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r)) + 0.5 * (1.0 - smoothstep(0.0, 0.3, length(q - vec2(-0.35, 0.35))));
    col = vec3(0.85, 0.95, 1.0);
  } else {
    a = (1.0 - r) * 0.6;
    col = vec3(0.75, 0.8, 0.72);
  }
  // Caught in her lamps, the snow in the water lights up: what makes the beam read as a beam.
  col += vec3(1.0, 0.95, 0.84) * vLamp * 1.6;   // LAMP_COL; the block itself is in the vertex shader
  a = min(1.0, a * (1.0 + vLamp * 2.5));
  float fade = uSub > 0.0 ? exp(-vDist * uExt * 0.45) : 1.0;
  frag = vec4(mix(waterAlong(uWater, vDz), col, fade), a * vA * fade);
}`, 'frag', true);

function compile(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('seabed ' + label + ': ' + gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, label + ' vertex'));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, label + ' fragment'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('seabed ' + label + ' link: ' + gl.getProgramInfoLog(p));
  return p;
}

export function createSeabedLayer(gl) {
  const bg = program(gl, BG_VERT, BG_FRAG, 'water');
  const mesh = program(gl, MESH_VERT, MESH_FRAG, 'bottom');
  const pts = program(gl, PT_VERT, PT_FRAG, 'points');
  const U = (p, n) => gl.getUniformLocation(p, n);
  const L = {
    lamp: [bg, mesh, pts].map((p) => ({ p, at: U(p, 'uLampP'), dir: U(p, 'uLampD'), on: U(p, 'uLampOn') })),
    bg: { inv: U(bg, 'uInvVP'), water: U(bg, 'uWater'), t: U(bg, 'uT'), lit: U(bg, 'uLit') },
    mesh: { vp: U(mesh, 'uViewProj'), eye: U(mesh, 'uEye'), water: U(mesh, 'uWater'), ext: U(mesh, 'uExt'), t: U(mesh, 'uT'), lit: U(mesh, 'uLit') },
    pts: { vp: U(pts, 'uViewProj'), focal: U(pts, 'uFocal'), eye: U(pts, 'uEye'), water: U(pts, 'uWater'), ext: U(pts, 'uExt'), sub: U(pts, 'uSub') },
  };
  const bgVao = gl.createVertexArray();
  // The terrain buffer changes only when the camera crosses a tile, so it is keyed on the scene's
  // own key rather than rewritten every frame. The props and points move and stream every frame.
  const terrVao = gl.createVertexArray(), propVao = gl.createVertexArray(), ptVao = gl.createVertexArray();
  const terr = makeVertexStream(gl, terrVao, 6, [[0, 3, 0], [1, 3, 12]], 1 << 16);
  const prop = makeVertexStream(gl, propVao, 6, [[0, 3, 0], [1, 3, 12]]);
  const pt = makeVertexStream(gl, ptVao, 6, [[0, 3, 0], [1, 3, 12]]);
  let terrKey = '', terrN = 0;
  // Her lamps onto whichever of the three programs is bound (s.lamp, from seabed-scene.js).
  function setLamp(prog, s) {
    const l = L.lamp.find((q) => q.p === prog), lp = s && s.lamp;
    gl.uniform1f(l.on, lp ? 1 : 0);
    if (lp) { gl.uniform3f(l.at, lp.x, lp.y, lp.z); gl.uniform3f(l.dir, lp.dx, lp.dy, lp.dz); }
  }

  // The opaque half: the water behind everything, then the bottom. Returns triangles drawn.
  function drawBottom(cam, s, cssH, dpr, eye, t) {
    if (!s || !(s.sub > 0)) return 0;
    const vpm = viewProjMatrix(cam, cssH), vp = mat4f(vpm);
    const inv = invert4(vpm);
    if (!inv) return 0;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    let n = 0;
    if (s.terrain && s.terrain.length) {
      if (terrKey !== s.key) { terr.write(s.terrain, s.terrain.length); terrN = s.terrain.length / 6; terrKey = s.key; }
      gl.useProgram(mesh); applyLinOut(gl, mesh);
      gl.uniformMatrix4fv(L.mesh.vp, false, vp);
      gl.uniform3f(L.mesh.eye, eye[0], eye[1], eye[2]);
      gl.uniform3fv(L.mesh.water, s.water);
      gl.uniform1f(L.mesh.ext, s.ext || 1);
      gl.uniform1f(L.mesh.t, t);
      gl.uniform1f(L.mesh.lit, s.lit);
      setLamp(mesh, s);
      gl.bindVertexArray(terrVao); gl.drawArrays(gl.TRIANGLES, 0, terrN); n += terrN / 3;
      if (s.props && s.props.length) {
        prop.write(s.props, s.props.length);
        gl.bindVertexArray(propVao); gl.drawArrays(gl.TRIANGLES, 0, s.props.length / 6); n += s.props.length / 18;
      }
    }
    // The water behind all of it, at the far plane: fills only what nothing else covered.
    gl.useProgram(bg); applyLinOut(gl, bg);
    gl.uniformMatrix4fv(L.bg.inv, false, mat4f(inv));
    gl.uniform3fv(L.bg.water, s.water);
    gl.uniform1f(L.bg.t, t);
    gl.uniform1f(L.bg.lit, s.lit);
    setLamp(bg, s);
    gl.depthMask(false);
    gl.bindVertexArray(bgVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.bindVertexArray(null);
    return n;
  }

  // The translucent half: bubbles and particles. Drawn after the surface so a bubble rising to it is
  // seen against it. Also runs on the surface, where the only points are the froth off the stern.
  function drawPoints(cam, s, cssH, dpr) {
    if (!s || !s.points || !s.points.length) return 0;
    const vp = mat4f(viewProjMatrix(cam, cssH));
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(pts); applyLinOut(gl, pts);
    gl.uniformMatrix4fv(L.pts.vp, false, vp);
    const eye = eyePos(cam);
    gl.uniform3f(L.pts.eye, eye[0], eye[1], eye[2]);
    gl.uniform1f(L.pts.focal, (cam.depth || 300) * dpr);
    gl.uniform3fv(L.pts.water, s.water || [0.1, 0.3, 0.4]);
    gl.uniform1f(L.pts.ext, s.ext || 1);
    gl.uniform1f(L.pts.sub, s.sub > 0 ? 1 : 0);
    setLamp(pts, s);
    pt.write(s.points, s.points.length);
    gl.bindVertexArray(ptVao); gl.drawArrays(gl.POINTS, 0, s.points.length / 6);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    return s.points.length / 6;
  }

  return { drawBottom, drawPoints };
}
