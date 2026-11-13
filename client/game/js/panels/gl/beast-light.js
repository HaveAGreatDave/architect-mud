// GLASS 2 · THE BEASTS' LIGHT: how an animal or a machine on the Room Stage is lit (gl/room.js draws the beasts layer
// with it). The room's lamps and panes, as gl/room-light.js has them, but coloured the way an animator's colour
// designer colours a monster rather than the way a lamp darkens a sofa:
//
//   · A DESIGNED SHADOW. Each surface carries its own shadow colour (packed in the vertex's uv.x by gl/beast-kit.js):
//     a slag wight's shadow is deep red, a sewer slime's a sickly teal. With none, the shadow is the base moved
//     toward the house's painted violet and pushed a little more saturated, never just darker.
//   · ONE KEY LIGHT. Lit or in shadow is decided by the strongest light's way (the lamps and panes summed by how much
//     each reaches this point), through the comic terminator, so a body takes one clean shadow shape.
//   · A COLOURED RIM. A crisp band round the silhouette (uv.y is its colour), brighter on the shadow side, as an
//     anime back light reads.
//   · ITS OWN LIGHT. A glowing part lights the body round it (uGlow*, up to eight per frame, set from the kit's
//     glows): a cinder saint's furnace throws orange up its own chest, a dragonfish lure lights its jaw.
//   · MATERIALS, BY MAT CODE: 40 burns as it is; 47 burns and pulses; 45 is a thin film whose hue turns with the angle
//     (beetle, oil, glass); 46 lets light through (slime, membrane, a leech's lip), the far side glowing its shadow
//     colour; gloss and metal take one hard highlight shape.
//
// The halos round glowing parts are a separate additive pass (HALO_*), soft shells drawn after everything solid.
import { ROOM_LIGHT_GLSL } from './room-light.js';

export const BEAST_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aCol;
layout(location = 4) in float aMat;
uniform mat4 uVP;
out vec3 vPos; out vec3 vNor; out vec3 vCol; flat out vec2 vPal; flat out float vMat;
invariant gl_Position;
void main() {
  vPos = aPos; vNor = aNor; vCol = aCol; vPal = aUv; vMat = aMat;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

export const BEAST_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec3 vCol; flat in vec2 vPal; flat in float vMat;
out vec4 outColor;
${ROOM_LIGHT_GLSL}
uniform float uTime;
uniform vec4 uGlowP[8];
uniform vec3 uGlowC[8];
uniform int uGlowN;
uniform vec3 uShadeTint;
uniform float uRimK;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 furHash(vec3 c) { return fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))) * 43758.5453); }
// a colour packed by the kit as 1 + r·65536 + g·256 + b, 8-bit sRGB, to linear
vec3 unpack(float f) {
  f -= 1.0;
  vec3 c = vec3(floor(f / 65536.0), mod(floor(f / 256.0), 256.0), mod(f, 256.0)) / 255.0;
  return pow(c, vec3(2.2));
}
void main() {
  gCurve = smoothstep(0.004, 0.03, length(fwidth(normalize(vNor))));
  vec3 base = vCol, n = normalize(vNor), v = normalize(uEye - vPos);
  if (dot(n, v) < 0.0) n = -n;
  float m = vMat;
  // FUR (gl/beast-kit.js furShells): a layer of the coat, its material 50 + its height in fifteenths and its normal's
  // length the fur's length. Each strand's root is found back on the skin. The strands stand at random points, one
  // in each cell of a grid, and a point of the coat belongs to the nearest, measured along the skin, so there are no
  // grid lines to band the coat and every strand is round. A strand's own height comes from its point, and a layer
  // keeps only the strands that reach it, thinning toward their tips. Lower down the coat is in its own shade.
  // Short fur (a face's) is finer and barely shaded, so it reads as velvet, not as spots: the grid is 1 mm for it and
  // 4 mm for long fur, and the shade deepens with the length. Most strands reach most of the way up and stay fat,
  // so the coat's edge reads as soft clumps, not as noise.
  if (m > 49.5 && m < 65.5) {
    float hh = (m - 50.0) / 15.0, fl = length(vNor), dens = clamp(4.6 / max(fl, 1e-4), 250.0, 950.0);
    vec3 nn = vNor / max(fl, 1e-6), q = (vPos - nn * hh * fl) * dens, ci = floor(q), bc = ci;
    float best = 9.0;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) {
      vec3 c = ci + vec3(float(i), float(j), float(k)), d = c + furHash(c) - q;
      d -= nn * dot(d, nn);
      float l = dot(d, d);
      if (l < best) { best = l; bc = c; }
    }
    float tall = 0.6 + 0.4 * furHash(bc + 7.0).x;
    if (hh > tall || sqrt(best) > 0.8 * (1.0 - hh / tall) + 0.14) discard;
    base *= mix(1.0 - 0.5 * smoothstep(0.003, 0.014, fl), 1.16, hh);
    m = 13.0;
  }
  if (m == 40.0 || m == 47.0) {
    float pu = m == 47.0 ? 0.62 + 0.38 * (0.5 + 0.5 * sin(uTime * 4.0 + dot(vPos, vec3(9.0, 13.0, 7.0)))) : 1.0;
    float core = smoothstep(0.55, 0.92, max(dot(n, v), 0.0)) * smoothstep(0.08, 0.5, lum(base));
    outColor = vec4(finish(mix(base * 1.7, vec3(lum(base) * 2.2 + 0.6), core * 0.75) * pu), 1.0);
    return;
  }
  // what light reaches here, and the way the most of it comes from
  vec3 E = vec3(0.0), K = vec3(0.0);
  for (int i = 0; i < 14; i++) {
    if (i >= uLampN) break;
    if (uLampRoom[i] != 0.0 || uLampK[i] <= 0.0) continue;
    vec3 L = uLampP[i] - vPos; float d2 = max(dot(L, L), 0.01); vec3 l = L * inversesqrt(d2);
    float att = mix(0.35, 1.0, smoothstep(-0.15, 0.35, l.y)) / (1.0 + d2 * 1.1) * uLampK[i];
    vec3 lc = uLampTinted == 1 ? uLampC * uLampTint[i] : uLampC;
    E += lc * att; K += l * att * lum(lc);
  }
  for (int w = 0; w < 3; w++) {
    if (w >= uWinCount) break;
    if (uWinK[w] <= 0.0) continue;
    vec3 L = uWinP[w] - vPos; float d2 = max(dot(L, L), 0.02); vec3 l = L * inversesqrt(d2);
    float att = max(dot(-l, uWinN[w]), 0.0) / (1.0 + d2 * 0.55) * uWinK[w];
    E += uWinC * att; K += l * att * lum(uWinC);
  }
  vec3 key = length(K) > 1e-5 ? normalize(K) : vec3(0.0, 1.0, 0.0);
  float d = dot(n, key), lit = comicStep(d);
  // the designed shadow: its own colour, or the base moved toward the house violet and kept saturated
  vec3 sh0 = base * uShadeTint, shade = vPal.x > 0.5 ? unpack(vPal.x) : mix(vec3(lum(sh0)), sh0, 1.3);
  vec3 litC = base * (uAmb + E * 0.95);
  vec3 shC = shade * (uAmb * 1.3 + E * 0.5) * comicShadeK(d);
  vec3 col = mix(shC, litC, lit);
  // the core: a thin band just past the terminator in a deeper, more saturated shadow (the third cel tone)
  float cw = max(fwidth(d) * 0.75, 0.01), core = smoothstep(-0.12 - cw, -0.12 + cw, d) * (1.0 - smoothstep(-0.02 - cw, -0.02 + cw, d));
  vec3 coreC = mix(vec3(lum(shade)), shade, 1.5) * 0.7;
  col = mix(col, coreC * (uAmb * 1.3 + E * 0.5), core * 0.65);
  // light through it: the far side glows its shadow colour
  if (m == 46.0) {
    float w = (d + 0.35) / 1.35, sw = 0.3, scatter = smoothstep(0.0, sw, w) * smoothstep(2.0 * sw, sw, w);
    float back = clamp(-d * 0.8 + 0.2, 0.0, 1.0), edge = 1.0 - max(dot(n, v), 0.0);
    col += mix(vec3(lum(shade)), shade, 1.3) * (E + uAmb) * (step(0.5, scatter) * 0.45 + back * 0.35 + edge * 0.3);
  }
  // a thin film: the hue turns with the angle it's seen at
  if (m == 45.0) {
    float c0 = max(dot(n, v), 0.0), dd = floor((sqrt(1.0 - (1.0 - c0 * c0) / 1.69) * 1.4 + vPos.y * 0.4) * 4.0) / 4.0;
    vec3 film = 0.5 + 0.5 * cos(6.2832 * (dd + vec3(0.0, 0.33, 0.67)));
    film = mix(film, vec3(0.2, 0.45, 1.0), smoothstep(0.5, 0.05, c0) * 0.5);
    col = mix(col, (col + 0.04) * film * 2.4, 0.35 + 0.45 * smoothstep(0.6, 0.15, c0));
  }
  // its own light: each glow lights what faces it, wrapped round so it reaches the turn
  for (int g = 0; g < 8; g++) {
    if (g >= uGlowN) break;
    vec3 L = uGlowP[g].xyz - vPos; float dl = length(L), r = uGlowP[g].w;
    if (dl > r) continue;
    float fall = 1.0 - dl / r; fall *= fall;
    float wrap = clamp((dot(n, L / max(dl, 1e-4)) + 0.6) / 1.6, 0.0, 1.0);
    col += mix(base, vec3(lum(base)), 0.3) * uGlowC[g] * fall * wrap * 2.2 + uGlowC[g] * fall * wrap * 0.04;
  }
  // the rim, crisp, its own colour, brighter on the shadow side and from above
  float f = 1.0 - max(dot(n, v), 0.0), fw = max(fwidth(f), 0.01);
  float curved = mix(0.12, 1.0, gCurve);
  float rimLit = smoothstep(0.716 - fw, 0.716 + fw, f * pow(max(d, 0.0), 0.1)) * lit * curved;
  float rimBack = smoothstep(0.8 - fw, 0.8 + fw, f) * (1.0 - lit * 0.6) * (0.7 + 0.3 * clamp(n.y + 0.4, 0.0, 1.0)) * curved;
  vec3 rimC = vPal.y > 0.5 ? unpack(vPal.y) : normalize(E + vec3(0.02)) * 0.9 + 0.1;
  col += (normalize(E + vec3(0.01)) * 0.6 + vec3(0.25, 0.22, 0.15)) * rimLit * 0.45 * lum(E + uAmb);
  col += rimC * rimBack * uRimK * (0.2 + 0.8 * lum(E + uAmb));
  // one hard highlight shape on what shines
  if (m == 4.0 || m == 6.0 || m == 5.0 || m == 45.0 || m == 46.0) {
    float h = dot(n, normalize(key + v)), cut = m == 6.0 ? 0.92 : m == 5.0 ? 0.96 : 0.99, hw = max(fwidth(h), 0.002);
    float hi = smoothstep(cut - hw, cut + hw, h) * lit * gCurve;
    col += (m == 6.0 ? mix(vec3(1.0, 0.95, 0.82), base * 2.5, 0.5) : vec3(1.0, 0.96, 0.84)) * hi * (0.35 + lum(E)) * (m == 5.0 ? 0.35 : 0.8);
  }
  outColor = vec4(finish(col), 1.0);
}`;

// The halos: soft shells round each glowing part, added over the frame. The shell is brightest where it faces the
// eye (the middle of the glow) and fades to nothing at its own silhouette, so it reads as light, not a ball.
export const HALO_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aCol;
uniform mat4 uVP;
out vec3 vPos; out vec3 vNor; out vec3 vCol; out float vK;
void main() { vPos = aPos; vNor = aNor; vCol = aCol; vK = aUv.x; gl_Position = uVP * vec4(aPos, 1.0); }`;
export const HALO_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec3 vCol; in float vK;
uniform vec3 uEye;
uniform float uTime;
out vec4 outColor;
void main() {
  float c = abs(dot(normalize(vNor), normalize(uEye - vPos)));
  // the falloff: hot and dense near the source, dropping off fast, never an even Gaussian
  float a = exp(-(1.0 - c) * 5.0) * smoothstep(0.0, 0.25, c) * vK * (0.92 + 0.08 * sin(uTime * 3.0 + vPos.x * 5.0));
  bool hot = vCol.r > vCol.b;
  vec3 outer = hot ? vec3(1.0, 0.22, 0.04) : vec3(0.1, 0.85, 1.0);
  vec3 hue = mix(outer * max(max(vCol.r, vCol.g), vCol.b), vCol, smoothstep(0.55, 0.95, c));
  outColor = vec4(pow(hue, vec3(1.0 / 2.2)) * a, 1.0);
}`;
