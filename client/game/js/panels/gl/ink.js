// GLASS 2 · THE INK: a thick dark outline round a body, as a cel-shaded game draws it.
//
// The rink (arena.js) and the kitchen (kitchen.js) draw their bodies twice: first in the ink
// colour, then lit. The ink pass pushes every vertex out along its normal by the width of the line
// on the screen (a world width, `uInk.x`, held between `uInk.y` and `uInk.z` pixels so a far body
// keeps a line and a near one doesn't get a slab) and sets it a little behind itself (`uInk.w`), so
// the body covers the inside and the line shows round its edge, and round anything held in front of
// it. An unlit vertex (a zero normal) gets none: it stays on the body, unpushed.
//
// Vertex layout: arena-mesh.js's, position at location 0 and normal at 1.
export const INK_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
uniform mat4 uVP;
uniform vec2 uShake;
uniform vec2 uRes;
uniform vec4 uInk;
void main() {
  float nl = dot(aNor, aNor);
  vec4 c = uVP * vec4(aPos, 1.0);
  // a vertex with no normal, or behind the eye, stays where it is unpushed: thrown off screen
  // alone, it dragged its triangle across the picture with it
  if (nl < 0.01 || c.w <= 0.0) { c.z += uInk.w * max(c.w, 0.0); gl_Position = c; return; }
  vec3 n = aNor * inversesqrt(nl);
  vec4 cn = uVP * vec4(aPos + n * uInk.x, 1.0);
  vec2 d = (cn.xy / max(cn.w, 1e-3) - c.xy / c.w) * uRes * 0.5;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(0.0);
  c.xy += dir * clamp(L, uInk.y, uInk.z) / (uRes * 0.5) * c.w;
  c.z += uInk.w * c.w;
  c.xy += uShake * c.w;
  gl_Position = c;
}`;
export const INK_FS = `#version 300 es
precision highp float;
uniform vec3 uCol;
out vec4 outColor;
void main() { outColor = vec4(uCol, 1.0); }`;
