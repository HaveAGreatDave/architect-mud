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

import { SEABED_R } from '../seabed-scene.js';
import { viewProjMatrix, mat4f } from './camera.js';
import { makeVertexStream } from './stream.js';

const BG_VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.99999, 1.0);
}`;
const BG_FRAG = `#version 300 es
precision highp float;
uniform vec3 uWater;
uniform float uHorY;
uniform float uH;
uniform float uT;
uniform float uLit;
out vec4 frag;
void main() {
  // Above the horizon is toward the surface and the light; below it is the deep.
  float up = clamp((gl_FragCoord.y - uHorY) / (uH * 0.5), -1.0, 1.0);
  vec3 col = uWater * (0.55 + 0.45 * up + 0.35 * max(up, 0.0));
  // Shafts: slow bands across the screen, only above the horizon, only with light to make them.
  float x = gl_FragCoord.x / uH;
  float s = sin(x * 9.0 + uT * 0.25) * 0.5 + sin(x * 23.0 - uT * 0.4) * 0.3 + sin(x * 4.0 + uT * 0.1) * 0.2;
  col += vec3(0.10, 0.18, 0.18) * pow(max(s, 0.0), 3.0) * max(up, 0.0) * uLit;
  frag = vec4(col, 1.0);
}`;

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
const MESH_FRAG = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vC;
uniform vec3 uEye;
uniform vec3 uWater;
uniform float uExt;
uniform float uT;
uniform float uLit;
out vec4 frag;
void main() {
  float d = distance(vW, uEye);
  float dep = max(0.0, -vW.z);
  // Caustics: the surface focusing the light into moving bright lines on the bottom. Strong in the
  // shallows, gone a few tiles down.
  vec2 p = vW.xy * 3.1;
  float c = sin(p.x * 1.7 + uT * 0.45) + sin(p.y * 1.9 - uT * 0.38) + sin((p.x + p.y) * 1.3 + uT * 0.26);   // slow: the surface above moves at a walking pace
  c = pow(max(0.0, c / 3.0), 3.0) * exp(-dep * 0.9) * uLit;
  vec3 col = vC * (0.35 + 0.65 * exp(-dep * 0.4) * uLit) + c * vec3(0.5, 0.75, 0.7);
  vec3 trans = exp(-d * uExt * vec3(1.05, 0.34, 0.22));
  // The patch ends at SEABED_R tiles: dissolve into the water well before it, so no edge is ever seen.
  float hd = distance(vW.xy, uEye.xy);
  float edge = smoothstep(${(SEABED_R * 0.5).toFixed(2)}, ${(SEABED_R * 0.92).toFixed(2)}, hd);
  frag = vec4(mix(col * trans + uWater * (1.0 - trans), uWater, edge), 1.0);
}`;

const PT_VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aMeta;
uniform mat4 uViewProj;
uniform float uFocal;
out float vA;
out float vKind;
out float vDist;
void main() {
  vec4 c = uViewProj * vec4(aPos, 1.0);
  gl_Position = c;
  gl_PointSize = clamp(aMeta.x * uFocal / max(c.w, 0.01), 1.0, 48.0);
  vA = aMeta.y; vKind = aMeta.z; vDist = c.w;
}`;
const PT_FRAG = `#version 300 es
precision highp float;
in float vA;
in float vKind;
in float vDist;
uniform vec3 uWater;
uniform float uExt;
uniform float uSub;
out vec4 frag;
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
  float fade = uSub > 0.0 ? exp(-vDist * uExt * 0.45) : 1.0;
  frag = vec4(mix(uWater, col, fade), a * vA * fade);
}`;

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
    bg: { water: U(bg, 'uWater'), horY: U(bg, 'uHorY'), h: U(bg, 'uH'), t: U(bg, 'uT'), lit: U(bg, 'uLit') },
    mesh: { vp: U(mesh, 'uViewProj'), eye: U(mesh, 'uEye'), water: U(mesh, 'uWater'), ext: U(mesh, 'uExt'), t: U(mesh, 'uT'), lit: U(mesh, 'uLit') },
    pts: { vp: U(pts, 'uViewProj'), focal: U(pts, 'uFocal'), water: U(pts, 'uWater'), ext: U(pts, 'uExt'), sub: U(pts, 'uSub') },
  };
  const bgVao = gl.createVertexArray();
  // The terrain buffer changes only when the camera crosses a tile, so it is keyed on the scene's
  // own key rather than rewritten every frame. The props and points move and stream every frame.
  const terrVao = gl.createVertexArray(), propVao = gl.createVertexArray(), ptVao = gl.createVertexArray();
  const terr = makeVertexStream(gl, terrVao, 6, [[0, 3, 0], [1, 3, 12]], 1 << 16);
  const prop = makeVertexStream(gl, propVao, 6, [[0, 3, 0], [1, 3, 12]]);
  const pt = makeVertexStream(gl, ptVao, 6, [[0, 3, 0], [1, 3, 12]]);
  let terrKey = '', terrN = 0;

  // The opaque half: the water behind everything, then the bottom. Returns triangles drawn.
  function drawBottom(cam, s, cssH, dpr, eye, t) {
    if (!s || !(s.sub > 0)) return 0;
    const vp = mat4f(viewProjMatrix(cam, cssH));
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    let n = 0;
    if (s.terrain && s.terrain.length) {
      if (terrKey !== s.key) { terr.write(s.terrain, s.terrain.length); terrN = s.terrain.length / 6; terrKey = s.key; }
      gl.useProgram(mesh);
      gl.uniformMatrix4fv(L.mesh.vp, false, vp);
      gl.uniform3f(L.mesh.eye, eye[0], eye[1], eye[2]);
      gl.uniform3fv(L.mesh.water, s.water);
      gl.uniform1f(L.mesh.ext, s.ext || 1);
      gl.uniform1f(L.mesh.t, t);
      gl.uniform1f(L.mesh.lit, s.lit);
      gl.bindVertexArray(terrVao); gl.drawArrays(gl.TRIANGLES, 0, terrN); n += terrN / 3;
      if (s.props && s.props.length) {
        prop.write(s.props, s.props.length);
        gl.bindVertexArray(propVao); gl.drawArrays(gl.TRIANGLES, 0, s.props.length / 6); n += s.props.length / 18;
      }
    }
    // The water behind all of it, at the far plane: fills only what nothing else covered.
    gl.useProgram(bg);
    gl.uniform3fv(L.bg.water, s.water);
    gl.uniform1f(L.bg.horY, (cssH - cam.horizonY) * dpr);
    gl.uniform1f(L.bg.h, cssH * dpr);
    gl.uniform1f(L.bg.t, t);
    gl.uniform1f(L.bg.lit, s.lit);
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
    gl.useProgram(pts);
    gl.uniformMatrix4fv(L.pts.vp, false, vp);
    gl.uniform1f(L.pts.focal, (cam.depth || 300) * dpr);
    gl.uniform3fv(L.pts.water, s.water || [0.1, 0.3, 0.4]);
    gl.uniform1f(L.pts.ext, s.ext || 1);
    gl.uniform1f(L.pts.sub, s.sub > 0 ? 1 : 0);
    pt.write(s.points, s.points.length);
    gl.bindVertexArray(ptVao); gl.drawArrays(gl.POINTS, 0, s.points.length / 6);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    return s.points.length / 6;
  }

  return { drawBottom, drawPoints };
}
