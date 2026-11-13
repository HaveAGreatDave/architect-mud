// GLASS 2 · THE ROOM STAGE'S LIGHT, as GLSL: the room's lamps, its windows (each an area light, four
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
// up to six lamps and three panes. An en-suite's lamp is the last, and with 'uAnnex' set (its box on
// the ground, x0 x1 z0 z1) it lights only in there and the rest light only outside it: nothing here
// casts a shadow, so without this the wall between would let everything through.
// After the room's own six come the lamps of the rooms next door (gl/room.js 'next'), up to eight. Each
// lights only inside its own room's box on the ground ('uNextBox', x0 x1 z0 z1), and the room's own
// light only outside those boxes, so a room seen through a doorway is lit as it will be when you walk
// into it. 'uLampRoom' is 0 for the room's own and 1 + the box otherwise; 'uLampHome' is how many are its own.
uniform vec3 uLampP[14];
uniform float uLampK[14];
uniform float uLampRoom[14];
uniform int uLampN;
uniform int uLampHome;
uniform vec4 uNextBox[4];
uniform int uNextN;
uniform vec3 uLampC;
// a club's lamps each have a colour of their own (gl/room.js, a lamp's 'tint'); with none set they
// are all uLampC
uniform vec3 uLampTint[14];
uniform int uLampTinted;
uniform vec3 uWinP[3];
uniform vec3 uWinN[3];
uniform vec3 uWinA[3];
uniform vec3 uWinB[3];
uniform float uWinK[3];
uniform int uWinCount;
uniform vec3 uWinC;
uniform vec4 uAnnex;
// past this z is the balcony: it's outdoors, so the lamps stop and the day lights it
uniform float uOutZ;
// and where the balcony wraps round the building: west of x, east of y, and south of z
uniform vec3 uOutRing;
uniform vec3 uAmb;
uniform float uExpo;
uniform float uComic;
uniform vec2 uRes;
// 0 in a room. On the street (gl/street-hd.js) the figure is one layer of GLASS's frame, which has its own
// vignette: 1 leaves the room's out, and 2 also hands back linear light, for GLASS's float target.
uniform float uStreet;
// shininess and strength of the highlight by MAT code (ballpark-mesh.js MAT)
vec2 specOf(float m) {
  if (m == 4.0) return vec2(90.0, 0.55);   // GLOSS
  if (m == 6.0) return vec2(42.0, 0.6);    // METAL
  if (m == 45.0) return vec2(160.0, 1.4);  // CHROME (room.js mirrors the room in it)
  if (m == 3.0) return vec2(24.0, 0.2);    // LEATHER
  if (m == 5.0) return vec2(30.0, 0.12);   // SATIN
  if (m == 1.0) return vec2(4.0, 0.02);    // CLOTH
  if (m == 13.0) return vec2(8.0, 0.025);  // MATTE
  return vec2(12.0, 0.05);
}
// how far the surface's normal turns across a pixel, 0 flat to 1 curved. A caller with flat faces sets
// it at the top of its main, before any return that depends on a varying, or fwidth is undefined.
float gCurve = 1.0;
vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 finish(vec3 c) {
  c = aces(c * uExpo);
  if (uStreet > 1.5) return c;
  c = pow(c, vec3(1.0 / 2.2));
  if (uStreet > 0.5) return c;
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  return c * (1.0 - 0.32 * dot(q, q) * 1.6);
}
float fresnelOf(vec3 n, vec3 v) { return pow(1.0 - max(dot(n, v), 0.0), 5.0); }
void roomLight(vec3 pos, vec3 n, vec3 v, float m, out vec3 diff, out vec3 spec) {
  vec2 sp = specOf(m);
  float fres = fresnelOf(n, v);
  float ks = sp.y * (m == 4.0 ? mix(1.0, 3.0, fres) : 1.0);
  diff = vec3(0.0); spec = vec3(0.0);
  if (pos.z > uOutZ || pos.x < uOutRing.x || pos.x > uOutRing.y || pos.z < uOutRing.z) { diff = uWinC * 0.3; return; }
  bool hasAnnex = uAnnex.y > uAnnex.x;
  bool inAnnex = hasAnnex && pos.x > uAnnex.x && pos.x < uAnnex.y && pos.z > uAnnex.z && pos.z < uAnnex.w;
  // the lamps: a bulb in a shade or a fitting in the ceiling, throwing most of its light down and out
  // the comic look throws the highlight away below leather (the step at the end), so it isn't worked out there
  bool wantSpec = uComic < 0.5 || sp.y >= 0.2;
  float rm = 0.0;
  for (int b = 0; b < 4; b++) {
    if (b >= uNextN) break;
    vec4 q = uNextBox[b];
    if (pos.x > q.x && pos.x < q.y && pos.z > q.z && pos.z < q.w) rm = float(b + 1);
  }
  for (int i = 0; i < 14; i++) {
    if (i >= uLampN) break;
    if (uLampRoom[i] != rm) continue;
    if (rm < 0.5 && (hasAnnex && i == uLampHome - 1) != inAnnex) continue;
    // a lamp that's off (the switch, the dimmer at nought, a strobe between flashes) costs nothing
    if (uLampK[i] <= 0.0) continue;
    vec3 L = uLampP[i] - pos; float d2 = max(dot(L, L), 0.01); vec3 l = L * inversesqrt(d2);
    float shade = mix(0.35, 1.0, smoothstep(-0.15, 0.35, l.y));
    float att = shade / (1.0 + d2 * 1.1) * uLampK[i];
    float nl = dot(n, l), lam = uComic > 0.5 ? mix(0.32, 0.85 + 0.15 * max(nl, 0.0), comicStep(nl)) : max(nl, 0.0);
    vec3 lc = uLampTinted == 1 ? uLampC * uLampTint[i] : uLampC;
    diff += lc * lam * att;
    if (wantSpec) spec += lc * pow(max(dot(n, normalize(l + v)), 0.0), sp.x) * ks * att * 2.0;
  }
  // the panes: four points across the glass, each lighting what faces it, and only into the room
  if (!inAnnex) for (int w = 0; w < 3; w++) {
    if (w >= uWinCount) break;
    if (uWinK[w] <= 0.0) continue;
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(i == 0 || i == 2 ? -0.35 : 0.35, i < 2 ? -0.35 : 0.35);
      vec3 q = uWinP[w] + uWinA[w] * o.x + uWinB[w] * o.y;
      vec3 L = q - pos; float d2 = max(dot(L, L), 0.02); vec3 l = L * inversesqrt(d2);
      float out_ = max(dot(-l, uWinN[w]), 0.0);
      float att = out_ / (1.0 + d2 * 0.55) * uWinK[w];
      float nl = dot(n, l), lam = uComic > 0.5 ? mix(0.32, 0.85 + 0.15 * max(nl, 0.0), comicStep(nl)) : max(nl, 0.0);
      diff += uWinC * 0.25 * lam * att;
      if (wantSpec) spec += uWinC * 0.25 * pow(max(dot(n, normalize(l + v)), 0.0), sp.x) * ks * att * 1.5;
    }
  }
  // the comic look draws a highlight as a hard glint, and only on a surface that shines (leather and
  // up): on wood, plaster or cloth the step turned a lamp's soft sheen into a flat white disc. It
  // is also kept off a flat face (a wall, a door, a panel), where the stepped lobe is a flat oval:
  // only a surface whose normal turns across the pixel (a lathe, a rounded edge) takes a glint.
  if (uComic > 0.5) spec = sp.y >= 0.2 ? step(0.35, dot(spec, vec3(0.333))) * vec3(0.9) * min(1.0, sp.y / 0.4) * gCurve : vec3(0.0);
}
vec3 roomShade(vec3 base, vec3 diff, vec3 spec, float m) { return base * (uAmb + diff) + spec * (m == 6.0 ? base * 1.6 + 0.2 : vec3(1.0)); }
// glass: the room faintly in it, a highlight, more of both at a glance
vec4 roomGlass(vec3 spec, float fres) {
  float a = 0.1 + 0.55 * fres + min(0.5, dot(spec, vec3(0.333)));
  return vec4(finish(uAmb * 0.6 + spec + vec3(0.04, 0.05, 0.06) * fres), a);
}`;
