// SHADOWS FROM SEVERAL LAMPS.
//
// gl/shadow.js casts the sun's shadow with one orthographic map laid over the city. A ballpark at
// night has no sun: its light towers throw the shadows, four of them at once, and each is a
// spotlight, so each needs a PERSPECTIVE map drawn from its own lamp bank toward the play. A night
// game's players stand in four soft shadows that overlap at their feet, and that, more than any
// grade, is what makes the picture read as lit by the park.
//
// What casts is up to the caller: the ballpark draws the players and the ball (docs/proposals/
// deadball-glass2.md, Lighting and the frame). The field and the stands carry their own shading,
// and a shadow pass over 50,000 triangles of seats to darken nothing would be a waste.
//
// ⚠ EVERY EXIT RETURNS null, as shadow.js's do. Half-installed is a black field: either the layer
// hands back its maps and matrices or the caller lights with no shadow at all.
//
// ⚠ FOUR SAMPLERS, NOT AN ARRAY. GLSL ES 3.00 indexes an array of samplers only with a constant,
// and a light loop's index isn't one, so the lookup is an if-chain over four named samplers.

import { perspective, lookAt, mul4 } from '../diamond/camera.js';
import { declareProgram, takeWarm } from './programs.js';

const SPOT_SHADOW_SIZE = 2048;
const SPOT_SHADOW_MAX = 4;

// How much of a sphere round the play a lamp's map can hold: a lamp can't see what's behind it,
// and a wide shot's sphere (300 ft round centre field) reaches past the near towers, so the sphere
// a map holds stops short of its own lamp.
export const spotReach = (lamp, focus, radius) => Math.min(radius, 0.8 * Math.hypot(focus[0] - lamp[0], focus[1] - lamp[1], focus[2] - lamp[2]));

// The light's view-projection, from its lamp toward the play: a cone just wide enough to hold the
// sphere round `focus` (spotReach of `radius`), its depth range just deep enough to hold it. Pure,
// so the gate can hold it to the points it must contain.
export function spotMatrix(lamp, focus, radius) {
  const d = Math.hypot(focus[0] - lamp[0], focus[1] - lamp[1], focus[2] - lamp[2]), r = spotReach(lamp, focus, radius);
  const fov = 2 * Math.asin(Math.min(0.999, r * 1.05 / d)) * 180 / Math.PI;
  return mul4(perspective(fov, 1, Math.max(1, d - r * 1.5), d + r * 1.5), lookAt(lamp, focus));
}

// The lookup the lit shader includes: `spotShadow(i, p)` is 1 lit and 0 in shadow for map i at the
// world point p, 1 off the map. Twelve taps of a Poisson disc, as the look-dev took them.
export const SPOT_SHADOW_GLSL = `
uniform highp sampler2DShadow uSpot0;
uniform highp sampler2DShadow uSpot1;
uniform highp sampler2DShadow uSpot2;
uniform highp sampler2DShadow uSpot3;
uniform mat4 uSpotM[${SPOT_SHADOW_MAX}];
uniform float uSpotTexel;
const vec2 SPOT_PD[12] = vec2[12](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064), vec2(0.896, 0.412),
  vec2(-0.322, -0.933), vec2(-0.792, -0.598));
float spotPcf(highp sampler2DShadow s, mat4 m, vec3 p) {
  vec4 c = m * vec4(p, 1.0);
  if (c.w <= 0.0) return 1.0;
  vec3 q = c.xyz / c.w * 0.5 + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
  float acc = 0.0;
  for (int i = 0; i < 12; i++) acc += texture(s, vec3(q.xy + SPOT_PD[i] * uSpotTexel * 1.8, q.z - 0.00012));
  return acc / 12.0;
}
float spotShadow(int i, vec3 p) {
  if (i == 0) return spotPcf(uSpot0, uSpotM[0], p);
  if (i == 1) return spotPcf(uSpot1, uSpotM[1], p);
  if (i == 2) return spotPcf(uSpot2, uSpotM[2], p);
  if (i == 3) return spotPcf(uSpot3, uSpotM[3], p);
  return 1.0;
}
`;

const VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(aPos, 1.0); }`;
const FRAG = `#version 300 es
precision mediump float;
void main() { }`;
declareProgram(VERT, FRAG);

export function createSpotShadows(gl, { size = SPOT_SHADOW_SIZE, count = SPOT_SHADOW_MAX } = {}) {
  let prog = takeWarm(gl, VERT, FRAG);
  if (!prog) {
    prog = gl.createProgram();
    for (const [t, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
      gl.attachShader(prog, sh); gl.deleteShader(sh);
    }
    gl.linkProgram(prog);
  }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  const uVP = gl.getUniformLocation(prog, 'uVP');
  const maps = [];
  for (let i = 0; i < Math.min(count, SPOT_SHADOW_MAX); i++) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); dispose(); return null; }
    maps.push({ tex, fbo, m: null });
  }
  const M = new Float32Array(16 * SPOT_SHADOW_MAX);

  // Draws each light's map: `lights` is [{ lamp, focus, radius }], `draw(viewProj, prog)` draws the
  // casters with aPos at location 0. Returns how many maps it drew.
  function render(lights, draw) {
    const n = Math.min(lights.length, maps.length);
    gl.useProgram(prog);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.0, 4.0);
    gl.viewport(0, 0, size, size);
    for (let i = 0; i < n; i++) {
      const L = lights[i], m = spotMatrix(L.lamp, L.focus, L.radius);
      maps[i].m = m; M.set(m, i * 16);
      gl.bindFramebuffer(gl.FRAMEBUFFER, maps[i].fbo);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(uVP, false, m);
      draw(m, prog);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return n;
  }
  // Binds the maps to four texture units from `unit` and sets the lookup's uniforms on `p`, a
  // program that includes SPOT_SHADOW_GLSL and is in use.
  function bind(u, unit) {
    for (let i = 0; i < SPOT_SHADOW_MAX; i++) {
      gl.activeTexture(gl.TEXTURE0 + unit + i);
      gl.bindTexture(gl.TEXTURE_2D, (maps[i] || maps[0]).tex);
      gl.uniform1i(u(`uSpot${i}`), unit + i);
    }
    gl.uniformMatrix4fv(u('uSpotM'), false, M);
    gl.uniform1f(u('uSpotTexel'), 1 / size);
  }
  function dispose() {
    for (const m of maps) { gl.deleteFramebuffer(m.fbo); gl.deleteTexture(m.tex); }
    maps.length = 0;
  }
  return { render, bind, dispose, get count() { return maps.length; }, size };
}
