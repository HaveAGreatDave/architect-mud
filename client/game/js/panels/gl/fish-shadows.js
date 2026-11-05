// FISH SHADOWS: a soft dark silhouette on the water over each fish a boat can see
// (docs/proposals/boat-fishing.md §4).
//
// One instanced quad per fish, laid flat on the sea's surface along the fish's heading. Which fish,
// and where, is fish-shadow-scene.js's arithmetic over client/shared/fish.js, packed by the boat seat
// and handed through FLOOR_STATE as `fishShadows: { data, n, chase }`; this draws it and decides
// nothing about a fish. Its own layer rather than gl/fauna.js, which is built round levels of detail
// for bird meshes: a shadow is a sprite, and the birds' budget stays theirs.
//
//   · DRAWN AFTER THE WATER, DEPTH-TESTED, WRITING NO DEPTH. The hull and the quay hide a shadow;
//     a shadow hides nothing. Each quad sits on the sea's height at its school and is pulled a
//     little toward the eye (PULL), so a crest the CPU height missed doesn't cut it.
//   · IT DARKENS, IT DOESN'T PAINT. The blend is dst * (1 - src): a shadow takes light out of the
//     water under it, whatever colour the water is, by day or under the lamp.
//   · DEEPER IS FAINTER, PER CHANNEL. The darkening is scaled by gl/seabed.js's own extinction
//     (SEABED_EXT, red first, then green, then blue) over the fish's depth, DEPTH_K times over, so
//     a fish in a couple of metres is a sharp dark shape and a sturgeon on the shelf floor is a faint
//     long smudge. The edge softens with depth too: sharp above 4 m, soft to 10 m, a blur below.
//   · TRUE SIZE FROM THE HELM. In the chase view the quad grows with its distance from the eye, up to
//     GROW_MAX times, so a metre-long fish still reads at chase zoom (§ open question 4).
//   · AT LINEAR LEVELS the darkening factor is decoded like a colour, since a multiply in display
//     values is a multiply by the decoded factor in linear light (gl/colour.js).
//
// Cost: nothing when the seat sends no list, which it doesn't under way or at night with no lamp.
//
// ⚠ NO BACKTICKS INSIDE THE SHADERS: they are template literals.

import { SEABED_EXT } from '../seabed-scene.js';
import { compileShader } from './programs.js';
import { viewProjMatrix, mat4f, eyePos } from './camera.js';
import { makeVertexStream } from './stream.js';
import { LINEAR_GLSL, applyLinOut } from './colour.js';
import { STRIDE } from '../fish-shadow-scene.js';
import { SEA_TILE_M, SEA_K } from '../../../../shared/sea-swell.js';

const DEPTH_K = 5;        // how many times the seabed's extinction a shadow's darkening crosses
const SHADE = 0.5;        // how much light a shallow fish's shadow takes out at its middle
const PULL = 0.03;        // tiles toward the eye, so the surface never cuts a shadow
const GROW_NEAR = 1.5 / SEA_K, GROW_SPAN = 2.5 / SEA_K, GROW_MAX = 2;   // chase view: tiles from the eye where it starts, over which it reaches GROW_MAX
const f3 = (v) => 'vec3(' + v.map((q) => q.toFixed(4)).join(', ') + ')';
const f1 = (v) => v.toFixed(4);

const VERT = `#version 300 es
layout(location = 0) in vec4 aP;     // x, y, z (tiles, map window), heading (radians, 0 along +x)
layout(location = 1) in vec4 aS;     // length, breadth (tiles), alpha, depth (metres)
layout(location = 2) in float aK;    // shape
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform float uGrow;
out vec2 vQ;
out float vA;
out float vDep;
out float vK;
out float vSoft;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  float dep = aS.w;
  // The edge, in the shape's own half-lengths: sharp above 4 m, soft to 10 m, a smudge below.
  float soft = mix(0.06, 0.45, smoothstep(4.0, 10.0, dep)) + 0.55 * smoothstep(10.0, 25.0, dep);
  float dist = length(aP.xyz - uEye);
  float k = 1.0 + uGrow * ${f1(GROW_MAX - 1)} * clamp((dist - ${f1(GROW_NEAR)}) / ${f1(GROW_SPAN)}, 0.0, 1.0);
  // A floor on the breadth so an eel's shadow is a line and not nothing.
  vec2 h = vec2(aS.x, max(aS.y, aS.x * 0.12)) * 0.5 * k * (1.0 + soft);
  vec2 along = vec2(cos(aP.w), sin(aP.w)), across = vec2(-along.y, along.x);
  vec3 p = vec3(aP.xy + along * c.x * h.x + across * c.y * h.y, aP.z);
  vec3 toEye = uEye - p;
  p += normalize(toEye) * min(${f1(PULL)}, length(toEye) * 0.5);
  gl_Position = uViewProj * vec4(p, 1.0);
  vQ = c * (1.0 + soft);
  vA = aS.z; vDep = dep; vK = aK; vSoft = soft;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vQ;
in float vA;
in float vDep;
in float vK;
in float vSoft;
out vec4 frag;
${LINEAR_GLSL}
// How far (x, y) is outside the silhouette, in the quad's half-lengths along and half-breadths
// across: negative inside. x runs -1 at the tail to +1 at the head; y is across, folded to >= 0.
float outside(float x, float y, float k) {
  float ends = abs(x) - 1.0;
  if (k > 4.5) {
    // A skate: a diamond, widest a little forward, with a thin tail behind it.
    float w = 1.0 - abs(x - 0.15) / (x > 0.15 ? 0.85 : 0.95);
    w = max(w, x < -0.5 ? 0.07 : 0.0);
    return max(y - w, ends);
  }
  if (k > 3.5) {
    // An eel: one width nearly all the way, tapering to the tail and rounding at the head.
    float w = mix(0.35, 1.0, smoothstep(-1.0, -0.2, x)) * (1.0 - smoothstep(0.8, 1.0, x));
    return max(y - w, ends);
  }
  // A fish: an ellipse fullest a little forward of the middle, narrowing to the wrist...
  float u = x > 0.2 ? (x - 0.2) / 0.8 : (x - 0.2) / 1.0;
  float b = sqrt(max(0.0, 1.0 - u * u)) * mix(0.3, 1.0, smoothstep(-0.75, -0.4, x));
  // ...and a tail fanning out behind it, forked at the end.
  // (edge0 < edge1 always: GLSL leaves smoothstep undefined the other way round)
  float fin = 0.8 * (1.0 - smoothstep(-1.0, -0.72, x));
  float notch = 0.35 * (1.0 - smoothstep(-1.0, -0.86, x));
  return max(min(y - b, max(y - fin, notch - y)), ends);
}
void main() {
  // Softened by depth: the edge is vSoft wide either side of the outline.
  float dOut = outside(vQ.x, abs(vQ.y), vK);
  float cov = 1.0 - smoothstep(-vSoft, vSoft, dOut);
  if (cov < 0.003) discard;
  // Per channel, the seabed's own curve, so red goes first.
  vec3 trans = exp(-(vDep / ${f1(SEA_TILE_M)}) * ${f3(SEABED_EXT)} * ${f1(DEPTH_K)});
  vec3 s = clamp(cov * vA * ${f1(SHADE)} * trans, 0.0, 0.95);
  // A multiply in display values is a multiply by the decoded factor in linear light.
  vec3 f = 1.0 - s;
  if (uGlassLinOut > 0.5) f = glassLin(f);
  frag = vec4(1.0 - f, 1.0);
}`;

function program(gl) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, VERT, 'fish shadow vertex'));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, FRAG, 'fish shadow fragment'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('fish shadows link: ' + gl.getProgramInfoLog(p));
  return p;
}

export function createFishShadowLayer(gl) {
  const prog = program(gl);
  const U = (n) => gl.getUniformLocation(prog, n);
  const L = { vp: U('uViewProj'), eye: U('uEye'), grow: U('uGrow') };
  const vao = gl.createVertexArray();
  const inst = makeVertexStream(gl, vao, STRIDE, [[0, 4, 0], [1, 4, 16], [2, 1, 32]], STRIDE * 128);
  // ⚠ ONE INSTANCE PER RECORD: the stream's pointers step per vertex until told otherwise.
  gl.bindVertexArray(vao);
  for (const l of [0, 1, 2]) gl.vertexAttribDivisor(l, 1);
  gl.bindVertexArray(null);

  /** `s` is { data, n, chase }. Returns instances drawn. */
  function draw(cam, s, cssH) {
    if (!s || !(s.n > 0) || !s.data) return 0;
    const vp = mat4f(viewProjMatrix(cam, cssH));
    const eye = eyePos(cam);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    // ⚠ SEPARATE, so the target's alpha is left alone: a plain blendFunc would zero it under
    // every shadow, and the canvas is composited with its alpha.
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
    gl.useProgram(prog); applyLinOut(gl, prog);
    gl.uniformMatrix4fv(L.vp, false, vp);
    gl.uniform3f(L.eye, eye[0], eye[1], eye[2]);
    gl.uniform1f(L.grow, s.chase ? 1 : 0);
    inst.write(s.data, s.n * STRIDE);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.n);
    gl.bindVertexArray(null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    return s.n;
  }
  return { draw };
}
