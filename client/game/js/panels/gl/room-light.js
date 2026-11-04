// GLASS 2 · THE ROOM STAGE'S LIGHT, as GLSL: the pendant lamp, the window (an area light, four
// points across the glass), the bounce, a highlight by MAT code, the comic look's bands and the
// finish. gl/room.js lights the room with it and gl/figure-hd.js lights the people in it, so a
// person stands in the same light as the chair beside them.

import { COMIC_LIGHT_GLSL } from './comic-light.js';

// The comic look (uComic) lights each light's share through the comic light's terminator
// (gl/comic-light.js comicStep): a surface turned from the lamp keeps about a third of it as fill,
// and the falloff across a wall stays smooth. (It used to band the summed light, which drew
// contour rings round the lamp across every wall.)
export const ROOM_LIGHT_GLSL = `
${COMIC_LIGHT_GLSL}
uniform vec3 uEye;
uniform vec3 uLampP;
uniform vec3 uLampC;
uniform vec3 uWinP;
uniform vec3 uWinN;
uniform vec3 uWinA;
uniform vec3 uWinB;
uniform vec3 uWinC;
uniform vec3 uAmb;
uniform float uExpo;
uniform float uComic;
uniform vec2 uRes;
// shininess and strength of the highlight by MAT code (ballpark-mesh.js MAT)
vec2 specOf(float m) {
  if (m == 4.0) return vec2(90.0, 0.55);   // GLOSS
  if (m == 6.0) return vec2(42.0, 0.6);    // METAL
  if (m == 3.0) return vec2(24.0, 0.2);    // LEATHER
  if (m == 5.0) return vec2(30.0, 0.12);   // SATIN
  if (m == 1.0) return vec2(4.0, 0.02);    // CLOTH
  if (m == 13.0) return vec2(8.0, 0.025);  // MATTE
  return vec2(12.0, 0.05);
}
vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 finish(vec3 c) {
  c = aces(c * uExpo);
  c = pow(c, vec3(1.0 / 2.2));
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  return c * (1.0 - 0.32 * dot(q, q) * 1.6);
}
float fresnelOf(vec3 n, vec3 v) { return pow(1.0 - max(dot(n, v), 0.0), 5.0); }
void roomLight(vec3 pos, vec3 n, vec3 v, float m, out vec3 diff, out vec3 spec) {
  vec2 sp = specOf(m);
  float fres = fresnelOf(n, v);
  float ks = sp.y * (m == 4.0 ? mix(1.0, 3.0, fres) : 1.0);
  diff = vec3(0.0); spec = vec3(0.0);
  // the pendant: a bulb in a shade that throws most of its light down and out
  {
    vec3 L = uLampP - pos; float d2 = max(dot(L, L), 0.01); vec3 l = L * inversesqrt(d2);
    float shade = mix(0.35, 1.0, smoothstep(-0.15, 0.35, l.y));
    float att = shade / (1.0 + d2 * 1.1);
    float nl = dot(n, l), lam = uComic > 0.5 ? mix(0.32, 0.85 + 0.15 * max(nl, 0.0), comicStep(nl)) : max(nl, 0.0);
    diff += uLampC * lam * att;
    spec += uLampC * pow(max(dot(n, normalize(l + v)), 0.0), sp.x) * ks * att * 2.0;
  }
  // the window: four points across the glass, each lighting what faces it, and only into the room
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(i == 0 || i == 2 ? -0.5 : 0.5, i < 2 ? -0.5 : 0.5);
    vec3 q = uWinP + uWinA * o.x + uWinB * o.y;
    vec3 L = q - pos; float d2 = max(dot(L, L), 0.02); vec3 l = L * inversesqrt(d2);
    float out_ = max(dot(-l, uWinN), 0.0);
    float att = out_ / (1.0 + d2 * 0.55);
    float nl = dot(n, l), lam = uComic > 0.5 ? mix(0.32, 0.85 + 0.15 * max(nl, 0.0), comicStep(nl)) : max(nl, 0.0);
    diff += uWinC * 0.25 * lam * att;
    spec += uWinC * 0.25 * pow(max(dot(n, normalize(l + v)), 0.0), sp.x) * ks * att * 1.5;
  }
  if (uComic > 0.5) spec = step(0.35, dot(spec, vec3(0.333))) * vec3(0.9);
}
vec3 roomShade(vec3 base, vec3 diff, vec3 spec, float m) { return base * (uAmb + diff) + spec * (m == 6.0 ? base * 1.6 + 0.2 : vec3(1.0)); }
// glass: the room faintly in it, a highlight, more of both at a glance
vec4 roomGlass(vec3 spec, float fres) {
  float a = 0.1 + 0.55 * fres + min(0.5, dot(spec, vec3(0.333)));
  return vec4(finish(uAmb * 0.6 + spec + vec3(0.04, 0.05, 0.06) * fres), a);
}`;
