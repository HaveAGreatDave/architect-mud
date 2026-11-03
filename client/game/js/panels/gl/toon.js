// GLASS 2 · THE CEL STEPS, as GLSL every toon shader splices in.
//
// The city mass (context.js), the tents (cloth.js) and the kitchen (kitchen.js) band their light
// with these two functions. They lived as copies in each shader; one changed its edge width and the
// others didn't.
//
// x rounded to the nearest of n even steps, and a hard step at an edge. Each edge is about a pixel
// wide, from the value's own rate of change across the pixel, so a band on a curve is antialiased
// rather than stair-stepped. ⚠ The width has a floor: on a flat face the value doesn't change,
// fwidth is 0, and smoothstep with equal edges is undefined. ⚠ In a shader that can turn the look
// off, call these only behind a uniform branch, for the derivative reason context.js's sunShadow
// gives.
export const TOON_GLSL = `
float toonBands(float x, float n) {
  float y = x * n;
  float w = max(fwidth(y), 1e-4);
  float i = floor(y);
  return (i + smoothstep(0.5 - w, 0.5 + w, y - i)) / n;
}
float toonStep(float edge, float x) {
  float w = max(fwidth(x), 1e-4);
  return smoothstep(edge - w, edge + w, x);
}
`;

// The shade side's multiply, the walls' (context.js), the tents' (cloth.js) and the bodies' below.
export const TOON_SHADE = 0.7;

// THE CITY'S INK ON A LAYER THAT ISN'T THE CITY: the vehicles (solids.js) and the people (actors.js)
// draw their depth into the ink prepass (gl/ssao.js `extraDepth`), so the line round a truck lands
// on the truck's own pixels, and the truck has to draw it. `inkMix` is context.js's ink block: r is
// the detail channel, g the outline, each faded out over its own distance (uInkFade, tiles from the
// eye; a layer passes its own distance, as it has no vDepth). Bind every draw, to the lines or to
// nothing: uInkStr 0 is off.
export const TOON_INK_GLSL = `
uniform highp sampler2D uInk;
uniform float uInkStr;
uniform vec4 uInkFade;
uniform vec3 uInkCol;
uniform vec2 uInkView;
uniform float uToon;
uniform float uToonBands;
const float TOON_SHADE = ${TOON_SHADE.toFixed(2)};
vec3 inkMix(vec3 c, float dist) {
  if (uInkStr <= 0.0) return c;
  vec2 e = textureLod(uInk, gl_FragCoord.xy / uInkView, 0.0).rg;
  float ink = max(e.x * (1.0 - smoothstep(uInkFade.x, uInkFade.y, dist)),
                  e.y * (1.0 - smoothstep(uInkFade.z, uInkFade.w, dist))) * uInkStr;
  return mix(c, uInkCol, ink);
}
`;
export const TOON_INK_UNIFORMS = ['uInk', 'uInkStr', 'uInkFade', 'uInkCol', 'uInkView', 'uToon', 'uToonBands'];

// Binds TOON_INK_GLSL's uniforms from `L` (a name → location map) on texture unit `unit`.
// `toon` is { toon, toonBands }, `K` the main pass's inkFrame (context.js) or null.
export function bindToonInk(gl, L, unit, toon, K) {
  gl.uniform1f(L.uToon, toon && toon.toon > 0 ? Math.min(1, toon.toon) : 0);
  gl.uniform1f(L.uToonBands, toon && toon.toonBands > 0 ? toon.toonBands : 3);
  gl.uniform1f(L.uInkStr, K && K.tex ? K.str : 0);
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, K ? K.tex : null); gl.uniform1i(L.uInk, unit);
  if (K) {
    gl.uniform4f(L.uInkFade, K.fade[0], K.fade[1], K.fade[2], K.fade[3]);
    gl.uniform3f(L.uInkCol, K.col[0], K.col[1], K.col[2]);
    gl.uniform2f(L.uInkView, K.W, K.H);
  }
  gl.activeTexture(gl.TEXTURE0);
}
