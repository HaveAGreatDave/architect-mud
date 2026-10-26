// GLASS 2 · THE BALLPARK. Deadball's park drawn by WebGL2 (the Grandstand, gameday-grandstand.js), in
// the Charles B. Hughson Coliseum as the map has it: the deco bowl and its roof (ballpark-mesh.js
// buildBowl). Six lights (lamp banks the venue reports working or not) are the only lights: the four
// corner towers and the rows under the two decks, the towers' crossing to the decks as the roof
// shuts (setRoof, roofLights). Linear light
// and GGX into hdr.js's multisampled float target, so lamps bloom; the last pass here applies the
// filmic curve and encodes. Parts: the park mesh (ballpark-mesh.js, pure, gated); the field painted
// in the shader with the infield canvas (diamond/dirt.js; markDirt re-uploads only touched texels,
// smoothDirt, setMats); the crowd (gl/crowd.js, instanced, setCrowd); the scoreboard from a 240×84
// mask (diamond/board.js); skinned players (gl/ballplayer-mesh.js buildBody, diamond/rig.js, built a
// few a frame so a cast never stalls, posed by gl/skin.js from diamond/cast.js or 'setPose'; faces
// from the atlas as in the Actor Lab); the bowl's limestone EXTERIOR and the name plates
// (paintPlates); the roof's three shells on their rails; and the city set
// (client/shared/city-set.js via gl/cityscape.js, sodium pools, gl/curtain.js), reached by the
// towers through a narrower beam.
// Frame order (docs/proposals/deadball-glass2.md): 1. tower shadow maps (gl/spotshadow.js);
// 2. main pass: sky, park, city, crowd, net, then pools, Curtain and spectacle (gl/spectacle.js)
// through height fog (fog.js), plus gl/weather.js (wet field in rain) and gl/citylights.js;
// 3. depth resolved to a texture; 4. half-size SSAO (ssao.js); 5. bloom (hdr.js), then lens,
// curve and grade (gl/broadcast.js).
// Nothing here decides anything; it draws through a shot (diamond/camera.js).
// 'createBallparkRenderer' returns null with no WebGL2, float target or shader, and the view falls
// back to the 2-D Gameday. ⚠ NO FACE CULLING, as in arena.js: builders don't keep one winding.

import { buildPark, buildDress, crowdMorph, createBatch, vtx, dragMat, lin, STRIDE, CROWD_STRIDE, CROWD_MORPH, MAT, BAY, BAND_RUNS, BAND_STONE, BAND_UV, MAIN_PLATE, PLATE_ATLAS, roofLights, roofTrack, shellShift } from './ballpark-mesh.js';
import { insideOutline, ftUp } from '../diamond/geo.js';
import { WIN, WIN_OPEN, RAYS, SUN, rayReach } from '../glass/coliseum-window.js';
import { breathe } from '../diamond/anim.js';
import { ROOF_MS } from '../world-feed.js';
import { CROWD_VS, CARD_VS, CARD_QUAD, flashesAt } from './crowd.js';
import { paintInfield, paintMark, smoothPoly, DIRT_RECT } from '../diamond/dirt.js';
import { boardLamps, BOARD_W, BOARD_H } from '../diamond/board.js';
import { shotMatrices, shotOf, inv4 } from '../diamond/camera.js';
import { createHDRLayer } from './hdr.js';
import { HEIGHT_FOG_GLSL, LIGHT_SHAFT_GLSL } from './fog.js';
import { createSpotShadows, SPOT_SHADOW_GLSL } from './spotshadow.js';
import { createDepthSSAO, ssaoConstants } from './ssao.js';
import { createBroadcastPass } from './broadcast.js';
import { makeVertexStream } from './stream.js';
import { declareProgram, prewarmPrograms, takeWarm } from './programs.js';
import { createPlayerSet, buildBody, POSES, mirrorPose, lookOf, faceFor, kitCell, SKIN_STRIDE, PLAYER_LODS } from './ballplayer-mesh.js';
import { solvePose, boneFrames, bindFrames, skinRows, BONES, FRAME_FLOATS } from '../diamond/rig.js';
import { BALL_R } from '../diamond/flight.js';
import { SKIN_GLSL, createBonePalette } from './skin.js';
import { bodyKey } from '../diamond/cast.js';
// the view loads this module lazily and takes the cast from it, so the 2-D path never fetches it
export { castOf } from '../diamond/cast.js';
import { paintKitAtlas, paintLogos, paintLeather, paintWood, paintMask, kitsFor } from '../diamond/kits.js';
import { FACE_GLSL, FACE_ATLAS } from '../actor-faces.js';
import { HAIRLINE_GLSL } from '../actor-head.js';
import { buildCityscape, FACADE_GLSL, STREET_GLSL, LIGHT_STRIDE } from './cityscape.js';
import { CURTAIN_FRAG } from './curtain.js';
import { applyLinOut } from './colour.js';
import { HUD_FACES, loadHudFaces } from '../diamond/hud.js';
import { createSpectacle } from './spectacle.js';
import { NIGHT, skyLook } from '../diamond/sky.js';
import { createWeather } from './weather.js';
import { createCityLights, PLUME } from './citylights.js';
import { createStreetLife } from './streetlife.js';
import { createParkBirds } from './parkbirds.js';
import { venueSet, streetLife, streetShot } from '../diamond/streets.js';
import { PARK_TIERS, dealFans } from '../diamond/quality.js';

const FACE = '"Arial Narrow", "Roboto Condensed", Arial, sans-serif';

// ── shaders ─────────────────────────────────────────────────────────────────
const LIT_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aCol;
layout(location = 4) in float aMat;
uniform mat4 uVP;
// where a batch is drawn from where it was built: a shell of the roof on its rails, nothing else
uniform vec3 uShift;
out vec3 vPos; out vec3 vNrm; out vec2 vUv; out vec3 vCol; flat out int vMat;
void main() { vPos = aPos + uShift; vNrm = aNrm; vUv = aUv; vCol = aCol; vMat = int(aMat + 0.5); gl_Position = uVP * vec4(vPos, 1.0); }`;
// The players: the same, skinned by their bones (gl/skin.js). A folded bone's vertices have no
// normal, and draw nothing.
const SKIN_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aCol;
layout(location = 4) in float aMat;
${SKIN_GLSL}
uniform mat4 uVP;
out vec3 vPos; out vec3 vNrm; out vec2 vUv; out vec3 vCol; flat out int vMat;
void main() {
  vec3 p = skinPos(aPos), n = skinDir(aNrm);
  vPos = p; vNrm = dot(n, n) > 1e-12 ? normalize(n) : vec3(0.0, 1.0, 0.0); vUv = aUv; vCol = aCol; vMat = int(aMat + 0.5);
  gl_Position = uVP * vec4(p, 1.0);
}`;
// The players into the towers' shadow maps, skinned the same way.
const SKIN_DEPTH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
${SKIN_GLSL}
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(skinPos(aPos), 1.0); }`;
const DEPTH_FS = `#version 300 es
precision mediump float;
void main() { }`;
// The park's own structure into the towers' maps (quality.stands): a roof's shell drawn where it has
// rolled to, as the lit pass draws it.
const STATIC_DEPTH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uVP;
uniform vec3 uShift;
void main() { gl_Position = uVP * vec4(aPos + uShift, 1.0); }`;

// What every lit pass shares: the six towers, the sky's ambient, and the night air.
const LIGHTS_GLSL = `
const float PI = 3.14159265;
uniform vec3 uLPos[6]; uniform vec3 uLCol[6]; uniform vec3 uLDir[6];
uniform vec3 uEye; uniform vec3 uSkyUp; uniform vec3 uSkyDn; uniform float uWet;
uniform vec3 uFogCol; uniform float uFogDens; uniform float uFogH; uniform float uShaft; uniform float uShaftReach;
// a flood's cone: full inside 32° of its axis, falling to a spill at 63°
float spotOf(int i, vec3 L, float spill) { return mix(spill, 1.0, smoothstep(0.45, 0.85, dot(-L, uLDir[i]))); }
// The floods as floods (uFlood 1; 0 is the park as first tuned, every light as strong to 700 ft):
// each falls off with the square of the distance from where its axis meets the ground (uLGeo.x, so
// the field under it is as bright as it was), at most FLOOD_HOT times that near the lamps; a
// tower's bank of lamps has a size (uLGeo.y, its radius) its highlights take; a deck's row is a
// line of lamps (along uLAx, half uLGeo.z long) lit from its nearest point; and the grass throws
// the towers' light back up (uBounce), onto what stands on it, gone by about 45 ft up. The three
// numbers a lamp share one vec3 because the lit shader sits near a phone's uniform limit.
uniform vec3 uLGeo[6]; uniform vec3 uLAx[6];
uniform float uFlood; uniform vec3 uBounce;
const float FLOOD_HOT = 2.0;
float floodAtt(int i, float d) {
  return uFlood > 0.5 ? min(FLOOD_HOT, uLGeo[i].x * uLGeo[i].x / (d * d)) * exp(-max(d - 900.0, 0.0) / 300.0) : exp(-max(d - 700.0, 0.0) / 240.0);
}
vec3 lampVec(int i, vec3 P) {
  if (uFlood > 0.5 && uLGeo[i].z > 0.0) { float s = clamp(dot(P - uLPos[i], uLAx[i]), -uLGeo[i].z, uLGeo[i].z); return uLPos[i] + uLAx[i] * s - P; }
  return uLPos[i] - P;
}
// the light from below at P: the ground's own ambient and what the field throws back up
vec3 belowAt(vec3 P) { return uSkyDn + uBounce * exp(-max(P.y, 0.0) / 45.0); }
${HEIGHT_FOG_GLSL}
${LIGHT_SHAFT_GLSL}
// The air between the eye and P: the haze, thicker near the ground, and each tower's light
// scattered toward the eye. fog.js works with height on z, so the points go in as xzy.
vec3 airOf(vec3 c, vec3 P) {
  float f = heightFog(uEye.y, P.y, length(P - uEye), uFogDens, uFogH);
  vec3 sc = vec3(0.0);
  for (int i = 0; i < 6; i++) sc += uLCol[i] * lightShaft(uEye.xzy, P.xzy, uLPos[i].xzy, uShaftReach, uFogDens, uFogH);
  return mix(c, uFogCol, f) + sc * uShaft;
}
// How much of a light added over the frame the air between hides.
float hazeOf(vec3 P) { return heightFog(uEye.y, P.y, length(P - uEye), uFogDens, uFogH); }
`;

// A player's head, as the Actor Lab shades the street figure's (actor-head.js, actor-faces.js): in
// sRGB like the lab, then into linear for the park's light. vUv is the face's front projection, so
// it's the point's x and y on the head in metres; vCol is (its bind z, the rest normal's z or an
// ear's hollow, the player's slot into uHead*). A slot's four vec4s are (skin, layout), (hair,
// style), (iris, eye black) and (lip, seed).
const HEAD_GLSL = `
float h13(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
${FACE_GLSL}
${HAIRLINE_GLSL}
vec3 hairAtP(vec3 r, float psi, vec3 hairC, int style, float seed) {
  float strand = style == 4 ? vn3(vec3(r.x * 320.0, r.y * 60.0 - r.z * 20.0, seed))
    : vn3(vec3(psi * 40.0, r.y * 14.0, seed)) * 0.6 + vn3(vec3(psi * 110.0, r.y * 30.0, seed + 7.0)) * 0.4;
  if (style == 3 && r.y < 1.62) strand = vn3(vec3(atan(r.x, -r.z) * 60.0, r.y * 6.0, seed));
  return hairC * (0.68 + 0.6 * strand);
}
// How shut his eyes are at world time t: one blink in each window of 2.8 to 5.2 s (his own, off his
// seed), starting somewhere in its first half, down and up again over 0.14 s.
float blinkAt(float t, float seed) {
  float period = 2.8 + 2.4 * fract(seed * 7.13 + 0.31);
  float ph = t / period + fract(seed * 3.7);
  float k = floor(ph);
  float u = (fract(ph) - 0.5 * fract(sin(k * 12.9898 + seed * 78.233) * 43758.5453)) * period;
  return u > 0.0 && u < 0.14 ? sin(u / 0.14 * PI) : 0.0;
}
void headShade(inout vec3 alb, inout float rough, inout float f0s, inout float wrap, inout float ao) {
  int pi = clamp(int(vCol.b + 0.5) + uHeadSlot, 0, 27);
  vec4 A = uHeadA[pi], Bh = uHeadB[pi], C = uHeadC[pi], D = uHeadD[pi];
  vec3 skin = A.rgb; int lay = int(A.a + 0.5); vec3 hairC = Bh.rgb; int style = int(Bh.a + 0.5);
  vec3 iris = C.rgb; float eyeBlack = C.a; vec3 lip = D.rgb; float seed = D.a;
  vec3 r = vec3(mix(-0.1, 0.1, vUv.x), mix(1.515, 1.765, vUv.y), vCol.r);
  float psi = atan(abs(r.x), r.z + 0.006);
  vec3 col = skin; float wet = 0.0;
  rough = 0.5; f0s = 0.028; wrap = 0.45; ao = 1.0;
  if (vMat == ${MAT.HAIR}) {
    float hl = hairlineAt(r);
    col = hairAtP(r, psi, hairC, style, seed);
    if (style == 1) col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.0012, abs(r.x - 0.024))) * smoothstep(1.7, 1.72, r.y) * smoothstep(-0.03, 0.02, r.z);
    ao = mix(0.85, 1.0, smoothstep(hl + 0.004, hl + 0.016, r.y));
    if (style == 4) { float cut = smoothstep(0.04, 0.05, abs(r.x)) * (1.0 - smoothstep(1.708, 1.722, r.y)); col = mix(col, mix(skin, hairC * 0.5, 0.5 + 0.3 * vn3(r * 900.0)), cut); }
    rough = 0.42; f0s = 0.035; wrap = 0.2;
  } else if (vMat == ${MAT.HEAD}) {
    float wt = smoothstep(0.1, 0.4, vCol.g);
    vec2 c0 = vec2(mod(float(lay), 8.0) / 8.0, (3.0 - floor(float(lay) / 8.0)) / 4.0);
    vec4 m = texture(uFaceAtlas, c0 + clamp(vUv, 0.0, 1.0) * vec2(0.125, 0.25));
    vec3 fc = faceColour(m, r, skin, hairC, lip, lip, 0.0, iris, wet);
    // a blink: the lids down over the eye's opening for about a seventh of a second, every few
    // seconds on his own beat
    float bl = blinkAt(uBlinkT, seed) * (1.0 - m.a);
    fc = mix(fc, skin * m.r * 1.5 * 0.82, bl); wet *= 1.0 - bl;
    col = mix(skin, fc, wt); wet *= wt;
    // eye black: a greasy stripe under each eye, along the top of the cheekbone
    float ax = abs(r.x);
    float ey = (r.y - 1.6185) / 0.0062, ex = (ax - 0.0325) / 0.0165;
    float eb = (1.0 - smoothstep(0.55, 1.0, ey * ey + ex * ex * ex * ex)) * (0.85 + 0.15 * vn3(r * 2400.0)) * eyeBlack * wt;
    col = mix(col, vec3(0.045, 0.04, 0.038), eb);
    // the scalp under the hair, with a soft broken edge for a hairline
    float hl = hairlineAt(r);
    float jit = 0.0026 * (vn3(vec3(psi * 70.0, r.y * 400.0, seed)) - 0.5);
    float sc = smoothstep(hl - 0.0025, hl + 0.0025, r.y + jit);
    col = mix(col, hairAtP(r, psi, hairC, style, seed) * 0.95, sc);
    ao = mix(1.0, 0.88, sc);
    col *= 1.0 - 0.18 * smoothstep(1.534, 1.522, r.y);
    rough = mix(mix(0.52, 0.16, clamp(wet, 0.0, 1.0)), 0.3, eb); f0s = mix(0.028, 0.04, clamp(wet + eb, 0.0, 1.0));
  } else if (vMat == ${MAT.EAR}) {
    col = skin * vec3(1.03, 0.94, 0.92) * (1.0 - 0.3 * vCol.g); ao = 1.0 - 0.3 * vCol.g;
  } else {
    float under = smoothstep(1.49, 1.535, r.y) * smoothstep(-0.02, 0.025, r.z);
    col = skin * (1.0 - 0.3 * under); ao = 1.0 - 0.25 * under;
  }
  alb = pow(max(col, vec3(0.0)), vec3(2.2));
}
`;

// The bowl's wall between the fins (ballpark-mesh.js buildBowl), as the map's Coliseum has it:
// limestone in coursed ashlar, and in every bay between the fins a tall window onto the concourse in
// a bronze frame with its tracery (glass/coliseum-window.js), a bronze spandrel over it and a gilt
// chevron in the spandrel, the concourse lit behind every night with people against the light, and
// the floods at the wall's foot washing up the stone. Under the name band on Sorrel Way and the
// boulevard (BAND_UV) the window stops short of it, with no spandrel. vUv is (feet along from the
// first fin, feet up); vCol.r is a seed a side, 0 outside on Sorrel Way and 0.25 outside on the
// boulevard. The numbers are the map's at the broadcast's size. On the outfield faces the glass is a
// hole in this wall and the tracery is geometry (ballpark-mesh.js tracery), so this paints only the
// stone, the frame's rim round the hole and the spandrel there.
const g3 = (hex) => `vec3(${lin(hex).map((v) => v.toFixed(5)).join(', ')})`;
// A window painted, from its spec (glass/coliseum-window.js), as a GLSL function of the point in its
// bay (q, feet from the bay's middle along and from the foot up): how much of it is the frame, the
// glass, the bronze across the glass and the gilt sun. A tile along the face is KH feet and a tile
// up 226, so the sun is round. The bronze is the mullions and the transoms, a panel over each light
// outside the middle one from its step up, and the step the sun rises off.
function windowGlsl(name, W) {
  const KH = BAY / 0.245, f = (x) => x.toFixed(3), F = (t) => f(t * KH), Z = (z) => f(ftUp(z));
  const zPerT = KH / ftUp(1), R0 = SUN.hub * 1.3 * KH, bar = F(W.bar), barV = Z(W.bar), m0 = F(W.mulls[0]), s0 = Z(W.steps[0]);
  const L = [];
  L.push(`void ${name}(vec2 q, float banded, vec2 fw, out float frame, out float glass, out float bars, out float sun) {`);
  L.push(`  float bu = q.x, v = q.y, ab = abs(bu), bx = fw.x * 1.5, by = fw.y * 1.5, head = 1.0 - banded;`);
  L.push(`  frame = rectAA(q, vec2(-${F(W.frame)}, ${Z(W.frameZ[0])}), vec2(${F(W.frame)}, mix(${Z(W.frameZ[1])}, ${Z(W.bandFrame)}, banded)), fw);`);
  L.push(`  glass = rectAA(q, vec2(-${F(W.hw)}, ${Z(W.z0)}), vec2(${F(W.hw)}, mix(${Z(W.z1)}, ${Z(W.band)}, banded)), fw);`);
  L.push('  bars = 0.0;');
  for (const m of W.mulls) L.push(`  bars = max(bars, 1.0 - smoothstep(${bar}, ${bar} + bx, abs(ab - ${F(m)})));`);
  for (const t of W.transoms) L.push(`  bars = max(bars, 1.0 - smoothstep(${barV}, ${barV} + by, abs(v - ${Z(t)})));`);
  W.steps.forEach((s, i) => L.push(`  bars = max(bars, head * smoothstep(${F(W.mulls[i] - W.bar)} - bx, ${F(W.mulls[i] - W.bar)} + bx, ab) * smoothstep(${Z(s - W.bar)} - by, ${Z(s - W.bar)} + by, v));`));
  L.push(`  bars = max(bars, head * (1.0 - smoothstep(${barV}, ${barV} + by, abs(v - ${s0}))) * (1.0 - smoothstep(${m0} - bx, ${m0} + bx, ab)));`);
  L.push(`  vec2 sq = vec2(bu, v - ${Z(W.steps[0] + W.bar)});`);
  L.push(`  sun = 1.0 - smoothstep(${F(SUN.hub)} - bx, ${F(SUN.hub)} + bx, length(sq));`);
  // each ray a triangle from just off the hub to its reach, its half-width tapering to nothing
  for (const deg of RAYS) {
    const a = deg * Math.PI / 180, R = rayReach(deg, zPerT, W) * KH;
    L.push(`  { vec2 d = vec2(${f(Math.cos(a))}, ${f(Math.sin(a))}); float al = dot(sq, d), w = ${f(SUN.foot * KH)} * clamp(1.0 - (al - ${f(R0)}) / ${f(R - R0)}, 0.0, 1.0);`);
    L.push(`    sun = max(sun, step(${f(R0)}, al) * step(al, ${f(R)}) * (1.0 - smoothstep(w, w + bx, abs(dot(sq, vec2(-d.y, d.x)))))); }`);
  }
  L.push(`  sun *= head * step(0.0, sq.y) * step(ab, ${m0});`);
  L.push('}');
  return L.join('\n');
}
const EXTERIOR_GLSL = `
float wallHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float rectAA(vec2 p, vec2 lo, vec2 hi, vec2 fw) { vec2 a = smoothstep(lo - fw, lo + fw, p) * (1.0 - smoothstep(hi - fw, hi + fw, p)); return a.x * a.y; }
${windowGlsl('winWall', WIN)}
${windowGlsl('winOpen', WIN_OPEN)}
const vec3 STONE = ${g3('#a48a66')}, BRONZE = ${g3('#604428')}, GILT_C = ${g3('#deb260')}, GLASS_C = ${g3('#1c262e')};
const vec3 FLOOD = vec3(1.0, 0.8, 0.58);
void exterior(out vec3 alb, out float rough, out float f0s, out vec3 emis, out float metal) {
  float u = vUv.x, v = vUv.y;
  vec2 fw = fwidth(vUv) + 1e-3;
  vec4 n1 = texture(uGrass, vUv / 9.0);
  const float BAY = ${BAY.toFixed(4)};
  float bu = (fract(u / BAY) - 0.5) * BAY, bayI = floor(u / BAY);
  vec2 q = vec2(bu, v);
  // the ashlar: courses of 2.6 ft, the joints staggered a course, fading out with distance
  float cv = v / 2.6, ju = u / 5.4 + 0.5 * mod(floor(cv), 2.0);
  float jw = max(fwidth(cv), fwidth(ju)), fade = 1.0 - smoothstep(0.08, 0.3, jw);
  float joint = max(1.0 - smoothstep(0.02, 0.02 + jw * 1.5, abs(fract(cv + 0.5) - 0.5)), 1.0 - smoothstep(0.01, 0.01 + jw * 1.5, abs(fract(ju + 0.5) - 0.5))) * fade;
  alb = STONE * (0.88 + 0.2 * n1.g) * (1.0 - 0.16 * joint);
  rough = 0.82; f0s = 0.03; metal = 0.0; emis = vec3(0.0);
  // the window, its frame and the spandrel over it; under the band, stopped short with no spandrel
  float bc = (bayI + 0.5) * BAY;
  vec2 br = vCol.r < 0.06 ? vec2(${BAND_UV.s.map((v) => v.toFixed(2)).join(', ')}) : abs(vCol.r - 0.25) < 0.06 ? vec2(${BAND_UV.n.map((v) => v.toFixed(2)).join(', ')}) : vec2(1e9, -1e9);
  float banded = step(br.x, bc) * step(bc, br.y);
  // the window (glass/coliseum-window.js): the outfield faces' bigger one where the wall's colour
  // says it's an open face (green), with no spandrel; where its glass is cut through, the paint
  // inside the frame is never drawn, and what's left is the frame's rim and a gate's shut bays
  float open = step(0.5, vCol.g), frame, glass, bars, sun;
  if (open > 0.5) winOpen(q, banded, fw, frame, glass, bars, sun);
  else winWall(q, banded, fw, frame, glass, bars, sun);
  float span = rectAA(q, vec2(-15.4, 66.9), vec2(15.4, 74.1), fw) * (1.0 - banded) * (1.0 - open);
  float bronze = max(frame, span);
  alb = mix(alb, BRONZE * (0.9 + 0.2 * n1.r), bronze); metal = bronze; rough = mix(rough, 0.34, bronze);
  float pane = glass * (1.0 - bars) * (1.0 - sun);
  alb = mix(alb, GILT_C, sun * glass); rough = mix(rough, 0.26, sun * glass);
  alb = mix(alb, GLASS_C, pane); metal *= 1.0 - pane; rough = mix(rough, 0.07, pane); f0s = mix(f0s, 0.06, pane);
  // the concourse behind it, lit every night but for a bay here and there, its people against the light
  float lit = step(0.16, wallHash(vec2(bayI, vCol.r * 17.0 + 3.0)));
  float crowd = step(v, 29.0) * smoothstep(0.35, 0.7, wallHash(vec2(floor(u / 1.8), 7.0)));
  emis += vec3(1.0, 0.80, 0.56) * pane * lit * (0.06 + 0.08 * smoothstep(22.6, 64.4, v)) * (1.0 - 0.8 * crowd);
  // the gilt chevron: an inverted V from the spandrel's lower corners up to its middle
  float ax = abs(bu), yl = 67.8 + (1.0 - ax / 7.1) * 4.3;
  float chev = step(ax, 7.1) * smoothstep(yl - fw.y, yl + fw.y, v) * (1.0 - smoothstep(yl + 1.36 - fw.y, yl + 1.36 + fw.y, v));
  alb = mix(alb, GILT_C, chev * span); rough = mix(rough, 0.26, chev * span);
  // the floods at the wall's foot, warm up the stone
  emis += alb * FLOOD * exp(-(v - 9.0) / 46.0) * 0.5 * (1.0 - pane);
}
`;

const LIT_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNrm; in vec2 vUv; in vec3 vCol; flat in int vMat;
uniform sampler2D uTex; uniform sampler2D uDirt; uniform sampler2D uGrass; uniform sampler2D uBoard;
uniform int uTextured; uniform float uAlphaTest; uniform float uAlpha; uniform float uEmis;
uniform vec3 uFence; uniform vec2 uBoardRes; uniform vec3 uBoardOn;
uniform float uCityLit; uniform float uPoolK;
// the roof: how shut it is (0 open, 1 shut), which keeps the rain off the field, and how much of the
// floods' light comes out through its glazing and the clerestory
uniform float uRoof; uniform float uDome;
uniform int uLSh[6]; uniform int uSpotN;
uniform sampler2D uFaceAtlas;
// a skinned player's slot: his face's place in the head arrays, and his jersey's cell in the kit
// atlas (gl/ballplayer-mesh.js KIT_REL); 0 and no cell for everything else
uniform int uHeadSlot; uniform vec4 uKitCell;
// the world's time, for the players' blinks; whether the kits' lettering stands off the cloth
uniform float uBlinkT; uniform float uTwill;
// how dirty this man's uniform is: low down, and up his front (gl/ballpark.js wear)
uniform vec2 uWear;
// the low sun: the way to it, its light (0 once it's down) and its shadow map's index (-1 none)
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform int uSunSh;
// With no tower casting (the phone tier), a soft dark patch on the ground under each man and the
// ball instead: (x, z, radius, how dark) each, uBlobN of them.
uniform vec4 uBlob[16]; uniform int uBlobN;
float blobAt(vec3 P) {
  float k = 1.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uBlobN) break;
    k *= 1.0 - uBlob[i].w * (1.0 - smoothstep(0.0, uBlob[i].z, length(P.xz - uBlob[i].xy)));
  }
  return k;
}
uniform vec4 uHeadA[28];
uniform vec4 uHeadB[28];
uniform vec4 uHeadC[28];
uniform vec4 uHeadD[28];
out vec4 o;
${LIGHTS_GLSL}
${SPOT_SHADOW_GLSL}
${HEAD_GLSL}
${FACADE_GLSL}
${STREET_GLSL}
${EXTERIOR_GLSL}
float ggxD(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float visSG(float NoV, float NoL, float a) { float a2 = a * a; float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2); float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2); return 0.5 / max(gv + gl, 1e-4); }
// the fence's distance at a bearing from straight-away centre: the venue's line, centre and curve
float fenceAt(float th) { return uFence.y - (uFence.y - uFence.x) * pow(clamp(abs(th) / 0.7853982, 0.0, 1.0), uFence.z); }
void main() {
  vec3 N = normalize(vNrm);
  vec3 V = normalize(uEye - vPos);
  vec4 tex = vec4(1.0);
  if (uTextured == 1) {
    vec2 uvT = (uKitCell.z > 0.0 && vUv.x >= 2.0) ? uKitCell.xy + (vUv - vec2(2.0, 0.0)) * uKitCell.zw : vUv;
    tex = texture(uTex, uvT); if (tex.a < uAlphaTest) discard;
    // The kit's lettering (the numbers, the wordmark, the name) stands off the cloth as tackle
    // twill does: the atlas's own brightness taken as height, its slope tilting the normal along a
    // frame worked out from the screen's derivatives, so the edges catch the floods in a close-up.
    // Gone once a texel's under a pixel or so, so it never shimmers at broadcast distance.
    if (uKitCell.z > 0.0 && uTwill > 0.5) {
      const vec3 LUM = vec3(0.299, 0.587, 0.114);
      vec2 e = vec2(1.5 / 2048.0, 0.0);
      float h0 = dot(tex.rgb, LUM), hx = dot(texture(uTex, uvT + e.xy).rgb, LUM), hy = dot(texture(uTex, uvT + e.yx).rgb, LUM);
      vec3 dp1 = dFdx(vPos), dp2 = dFdy(vPos); vec2 du1 = dFdx(uvT), du2 = dFdy(uvT);
      vec3 q2 = cross(dp2, N), q1 = cross(N, dp1);
      vec3 T = q2 * du1.x + q1 * du2.x, Bt = q2 * du1.y + q1 * du2.y;
      float im = inversesqrt(max(max(dot(T, T), dot(Bt, Bt)), 1e-20)); T *= im; Bt *= im;
      float tp = length(fwidth(uvT)) * 2048.0, k = (1.0 - smoothstep(0.7, 1.8, tp)) * step(2.0, vUv.x);
      // and the cloth's own weave, a thread every three texels each way, over and under; only
      // where a thread is two pixels or more, so it's a texture in a close-up and nothing further off
      vec2 wv = uvT * (2048.0 / 3.0) * 3.14159;
      float kw = (1.0 - smoothstep(0.25, 0.6, tp)) * float(vMat == ${MAT.CLOTH});
      vec2 weave = vec2(cos(wv.x) * (0.5 + 0.5 * sin(wv.y)), cos(wv.y) * (0.5 - 0.5 * sin(wv.x))) * 0.12 * kw;
      N = normalize(N - 2.2 * k * ((hx - h0) * T + (hy - h0) * Bt) - weave.x * T - weave.y * Bt);
    }
  }
  vec3 alb = vCol * tex.rgb;
  // the game on his uniform (uWear): infield dirt ground into the cloth low down, his knees, shins
  // and seat, and up his front after a dive, in blotches fixed on the cloth (its uv) so they move
  // with him; a slide's worth is plain from the stands, a game's crouching shows on a catcher
  if (uKitCell.z > 0.0 && uWear.x + uWear.y > 0.0 && vMat == ${MAT.CLOTH}) {
    vec2 cu = vUv * vec2(9.0, 23.0);
    float blot = smoothstep(0.35, 0.75, vn3(vec3(cu, 1.7)) * 0.65 + vn3(vec3(cu * 3.1, 4.2)) * 0.35);
    float low = 1.0 - smoothstep(1.1, 2.9, vPos.y), up = smoothstep(2.6, 3.4, vPos.y) * (1.0 - smoothstep(4.4, 5.0, vPos.y));
    float d = clamp(uWear.x * low * (0.35 + 0.65 * blot) + uWear.y * up * blot, 0.0, 0.85);
    alb = mix(alb, vec3(0.16, 0.088, 0.048), d);
  }
  if (vMat == ${MAT.EMISSIVE}) { o = vec4(airOf(alb * uEmis, vPos), uAlpha * tex.a); return; }
  if (vMat == ${MAT.POOL}) {
    // a pool of lamplight, added over the ground: the light under a lamp 26 ft up across a quad
    // 38 ft round (gl/cityscape.js), faded at its rim
    vec2 q = vUv * 2.0 - 1.0; float d2 = dot(q, q), h = 26.0 / 38.0;
    float E = pow(h * h / (d2 + h * h), 1.5) * (1.0 - smoothstep(0.6, 1.0, sqrt(d2)));
    o = vec4(vCol * E * uPoolK * (1.0 - hazeOf(vPos)), 1.0);
    return;
  }
  if (vMat == ${MAT.BOARD}) {
    // a face of lamps: each cell of the grid is one bulb, lit where the mask says. A lit bulb is
    // hottest at its filament; an unlit one is glass catching a little light up and to the left;
    // between them the black louvre takes a little of whatever burns either side. Seen from too
    // far for a bulb to be a few pixels, it's the bulbs' mean.
    vec2 g = vUv * uBoardRes, f = fract(g) - 0.5, cell = floor(g);
    float on = texture(uBoard, (cell + 0.5) / uBoardRes).r;
    float fw = max(fwidth(g.x), fwidth(g.y)), r = length(f);
    float bulb = 1.0 - smoothstep(0.32 - fw * 0.5, 0.4 + fw * 0.5, r), hot = 1.0 - smoothstep(0.0, 0.34, r);
    float nb = 0.25 * (texture(uBoard, (cell + vec2(1.5, 0.5)) / uBoardRes).r + texture(uBoard, (cell + vec2(-0.5, 0.5)) / uBoardRes).r
      + texture(uBoard, (cell + vec2(0.5, 1.5)) / uBoardRes).r + texture(uBoard, (cell + vec2(0.5, -0.5)) / uBoardRes).r);
    vec3 lit = uBoardOn * (0.55 + 0.9 * hot);
    vec3 dark = vec3(0.03, 0.022, 0.014) * (0.5 + 0.9 * (1.0 - smoothstep(0.0, 0.2, length(f - vec2(-0.1, 0.12)))));
    vec3 gap = vec3(0.003) + uBoardOn * 0.012 * max(on, nb);
    vec3 col = mix(gap, mix(dark, lit, on), bulb);
    col = mix(col, mix(vec3(0.02, 0.01, 0.004), uBoardOn, on) * 0.42 + vec3(0.002), smoothstep(0.6, 1.4, fw));
    o = vec4(airOf(col, vPos), 1.0);
    return;
  }
  float rough = 0.85, metal = 0.0, wrap = 0.0, f0s = 0.04, ao = 1.0;
  vec3 emis = vec3(0.0);
  // the city and the park's outside stand past where the floods are aimed (below)
  bool far = vMat == ${MAT.FACADE} || vMat == ${MAT.STREET} || vMat == ${MAT.EXTERIOR} || vMat == ${MAT.DECO} || vMat == ${MAT.GILT} || vMat == ${MAT.PLAQUE};
  if (vMat == ${MAT.FACADE}) { facade(alb, rough, f0s, emis, metal); ao = mix(0.62, 1.0, smoothstep(0.0, 1.6, vPos.y)); }
  else if (vMat == ${MAT.STREET}) { street(alb, rough, f0s); }
  else if (vMat == ${MAT.EXTERIOR}) {
    // from inside the park its back is plain
    if (dot(N, V) < 0.0) { alb = vec3(0.022, 0.021, 0.02); rough = 0.95; N = -N; }
    else exterior(alb, rough, f0s, emis, metal);
    ao = mix(0.62, 1.0, smoothstep(0.0, 1.6, vPos.y));
  } else if (vMat == ${MAT.DECO}) {
    // the bowl's stone, its towers and its gates: coursed, mottled, and washed by the floods at its foot.
    // A carved face (uv.x negative, the Guardians) is dressed stone with no coursing; the name band's
    // face takes its cut letters from the plates' atlas (alb, the texture under vCol).
    float cv = vPos.y / 2.6, jw = fwidth(cv);
    float joint = (1.0 - smoothstep(0.02, 0.02 + jw * 1.5, abs(fract(cv + 0.5) - 0.5))) * (1.0 - smoothstep(0.08, 0.3, jw)) * step(-0.5, vUv.x);
    vec4 nz = texture(uGrass, (vPos.xz + vPos.yy) / 9.0);
    alb = alb * (0.9 + 0.18 * nz.g) * (1.0 - 0.12 * joint);
    rough = 0.8; f0s = 0.03;
    emis = alb * vec3(1.0, 0.8, 0.58) * exp(-vPos.y / 50.0) * 0.5;
    ao = mix(0.62, 1.0, smoothstep(0.0, 1.6, vPos.y));
  } else if (vMat == ${MAT.GILT}) {
    // its bronze, its gilt and its rails: metal, and the floods' warm light on the low work
    rough = 0.3; metal = 1.0;
    emis = alb * vec3(1.0, 0.8, 0.58) * exp(-vPos.y / 60.0) * 0.35;
  } else if (vMat == ${MAT.PLAQUE}) {
    // a name plate, bronze and gilt as painted, floodlit from below after dark
    rough = 0.36; f0s = 0.08; metal = 0.25;
    emis = alb * vec3(1.0, 0.86, 0.66) * 0.9;
  } else if (vMat == ${MAT.GLAZE}) {
    // glass lit from inside after dark: the roof's glazing and the clerestory by how shut the roof
    // is (uv.x 0), the towers' slits, the lobby and the gates every night (uv.x 1)
    rough = 0.06; f0s = 0.06;
    emis = vUv.x > 1.5 ? vec3(0.0) : vUv.x > 0.5 ? vec3(1.0, 0.83, 0.6) * 0.14 : vec3(1.0, 0.84, 0.62) * 0.16 * uDome;
  } else if (vMat == ${MAT.GROUND}) {
    // the field, painted: grass and its mowing, the track, the lines, then the infield canvas
    vec2 xz = vPos.xz;
    vec2 duv = (xz - vec2(${DIRT_RECT.x0.toFixed(1)}, ${DIRT_RECT.z0.toFixed(1)})) / ${DIRT_RECT.size.toFixed(1)};
    bool inC = all(greaterThanEqual(duv, vec2(0.0))) && all(lessThanEqual(duv, vec2(1.0)));
    vec4 dirt = inC ? texture(uDirt, duv) : vec4(0.0);
    vec4 g1 = texture(uGrass, xz / 2.4), g2 = texture(uGrass, xz / 53.0), g3 = texture(uGrass, xz / 0.8);
    float th = atan(xz.x, xz.y), r = length(xz);
    float fair = step(abs(th), 0.7854) * step(0.0, xz.y);
    // the stripes: cut in two directions, each lighter or darker as the camera looks with or
    // against the grain, the way mown grass reads on television
    vec2 vd = normalize(V.xz + 1e-5);
    float s1 = smoothstep(-0.06, 0.06, sin((xz.x + xz.y) * PI / 15.0));
    float s2 = smoothstep(-0.06, 0.06, sin((xz.x - xz.y) * PI / 15.0));
    float mow = (0.20 * (s1 * 2.0 - 1.0) * dot(vd, vec2(0.7071, 0.7071)) + 0.15 * (s2 * 2.0 - 1.0) * dot(vd, vec2(-0.7071, 0.7071))) * mix(0.5, 1.0, fair);
    vec3 grass = vec3(0.036, 0.105, 0.024) * (0.74 + 0.36 * g1.r + 0.12 * g3.b) * (0.84 + 0.30 * g2.g) * (1.0 + mow);
    float wr = fenceAt(th);
    float trk = fair * smoothstep(wr - 15.6, wr - 14.9, r);
    alb = mix(grass, vec3(0.16, 0.082, 0.046) * (0.8 + 0.4 * g3.b), trk);
    if (!inC) {
      // the foul lines past the canvas, out to the wall
      float dl = min(abs(xz.x - xz.y), abs(xz.x + xz.y)) * 0.7071; float fw = fwidth(dl) + 0.01;
      alb = mix(alb, vec3(0.78), (1.0 - smoothstep(0.14 - fw, 0.14 + fw, dl)) * step(0.0, xz.y) * step(r, wr - 0.3));
    }
    // the canvas is premultiplied: where it's clear, the grass shows
    alb = alb * (1.0 - dirt.a) + dirt.rgb * (0.82 + 0.36 * g3.r) * (0.92 + 0.16 * g1.b);
    rough = mix(0.86, 0.96, max(dirt.a, trk)); f0s = 0.012;
    // wet: the dirt and the track darker with a dull sheen, and puddles lying flat in their low
    // spots that catch the floods; the grass a little darker. Under the roof it stays dry.
    float wetIn = uWet * (1.0 - uRoof);
    float wetD = wetIn * max(dirt.a, trk), wetG = wetIn * (1.0 - max(dirt.a, trk));
    float pud = wetD * smoothstep(0.54, 0.68, g1.b * 0.45 + g2.g * 0.55);
    alb *= 1.0 - 0.46 * wetD - 0.12 * wetG;
    rough = mix(mix(rough, 0.64, wetD * 0.8 + wetG * 0.1), 0.2, pud); f0s = mix(f0s, 0.03, wetD + wetG * 0.3);
    // outside the field, under the stands: concrete
    float d1 = (xz.x + xz.y) * 0.7071, d3 = (xz.y - xz.x) * 0.7071;
    bool field = (r < wr + 2.0 && xz.y > -30.0 && min(d1, d3) > -40.0) || r < 58.0;
    if (!field) { alb = vec3(0.060, 0.058, 0.055) * (0.85 + 0.3 * g2.g); dirt.a = 1.0; }
    N = normalize(vec3(((g1.r - 0.5) * 0.18 * (1.0 - dirt.a) + (g3.b - 0.5) * 0.12) * (1.0 - pud), 1.0, (g1.g - 0.5) * 0.12 * (1.0 - pud)));
  } else {
    if (vMat == ${MAT.CLOTH}) { rough = 0.9; wrap = 0.25; }
    else if (vMat == ${MAT.SKIN}) { rough = 0.48; wrap = 0.45; f0s = 0.028; }
    else if (vMat == ${MAT.LEATHER}) { rough = 0.42; f0s = 0.04; }
    else if (vMat == ${MAT.GLOSS}) { rough = 0.1; f0s = 0.05; }
    else if (vMat == ${MAT.SATIN}) { rough = 0.32; }
    else if (vMat == ${MAT.METAL}) { rough = 0.38; metal = 1.0; }
    else if (vMat == ${MAT.CONCRETE}) { rough = 0.9; }
    else if (vMat == ${MAT.PAD}) { rough = 0.62; }
    else if (vMat == ${MAT.PLATE}) { rough = 0.5; }
    else if (vMat == ${MAT.MATTE}) { rough = 0.92; }
    else if (vMat == ${MAT.BALL}) {
      // the ball's leather and its red stitched seam, on the curve a ball's two figure-eight
      // pieces meet along (a + b = 1 keeps it on the sphere), as far round as the ball has spun
      vec3 u = normalize(vCol); float dm = 4.0, tm = 0.0;
      for (int k = 0; k < 48; k++) {
        float t = float(k) * 0.1309;
        vec3 c = vec3(0.68 * cos(t) + 0.32 * cos(3.0 * t), 0.68 * sin(t) - 0.32 * sin(3.0 * t), 0.933 * sin(2.0 * t));
        float d2 = dot(u - c, u - c);
        if (d2 < dm) { dm = d2; tm = t; }
      }
      // then closer in round the nearest sample, so the seam is a line and not a row of beads
      float lo = tm - 0.1309, hi = tm + 0.1309;
      for (int k = 0; k < 10; k++) {
        float a = mix(lo, hi, 0.382), b = mix(lo, hi, 0.618);
        vec3 ca = vec3(0.68 * cos(a) + 0.32 * cos(3.0 * a), 0.68 * sin(a) - 0.32 * sin(3.0 * a), 0.933 * sin(2.0 * a));
        vec3 cb = vec3(0.68 * cos(b) + 0.32 * cos(3.0 * b), 0.68 * sin(b) - 0.32 * sin(3.0 * b), 0.933 * sin(2.0 * b));
        if (dot(u - ca, u - ca) < dot(u - cb, u - cb)) hi = b; else lo = a;
      }
      tm = 0.5 * (lo + hi);
      vec3 cm = vec3(0.68 * cos(tm) + 0.32 * cos(3.0 * tm), 0.68 * sin(tm) - 0.32 * sin(3.0 * tm), 0.933 * sin(2.0 * tm));
      dm = dot(u - cm, u - cm);
      // the seam's red stitches, in a chevron either side of the join, with the leather between
      float seam = 1.0 - smoothstep(0.0012, 0.0045, dm);
      float stitch = seam * (0.55 + 0.45 * smoothstep(0.25, 0.5, abs(fract(tm * 32.0 + sqrt(dm) * 12.0) - 0.5) * 2.0));
      alb = mix(vec3(0.86, 0.84, 0.78), vec3(0.62, 0.05, 0.04), stitch);
      rough = 0.55; f0s = 0.03;
    }
    // what's near the ground sees less of the sky
    float aoH = mix(0.62, 1.0, smoothstep(0.0, 1.6, vPos.y));
    if (vMat >= ${MAT.HEAD} && vMat <= ${MAT.NECK}) { headShade(alb, rough, f0s, wrap, ao); ao *= aoH; }
    else ao = aoH;
  }
  vec3 f0 = mix(vec3(f0s), alb, metal);
  vec3 dif = alb * (1.0 - metal);
  float a = max(rough * rough, 0.003);
  float NoV = max(dot(N, V), 1e-3);
  vec3 below = belowAt(vPos);
  vec3 col = dif * mix(below, uSkyUp, N.y * 0.5 + 0.5) * ao;
  vec3 R = reflect(-V, N);
  vec3 env = mix(below * 1.4, uSkyUp * 2.2, clamp(R.y * 0.6 + 0.5, 0.0, 1.0));
  vec3 Fv = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - NoV, 5.0);
  col += env * Fv * ao * (1.0 - rough * 0.6);
  for (int i = 0; i < 6; i++) {
    vec3 Lv = far ? uLPos[i] - vPos : lampVec(i, vPos); float d = length(Lv); vec3 L = Lv / d;
    float NoL = dot(N, L);
    float wd = max((NoL + wrap) / (1.0 + wrap), 0.0), nl = max(NoL, 0.0);
    // the highlight off a bank of lamps with a size: toward the point of the bank nearest the
    // reflected ray, the lobe widened to match and its energy kept
    vec3 Ls = L; float aS = a;
    if (uFlood > 0.5 && uLGeo[i].y > 0.0) {
      vec3 c2r = dot(Lv, R) * R - Lv;
      Ls = normalize(Lv + c2r * clamp(uLGeo[i].y / max(length(c2r), 1e-4), 0.0, 1.0));
      aS = clamp(a + uLGeo[i].y / (2.0 * d), 0.003, 1.0);
    }
    float nls = max(dot(N, Ls), 0.0);
    vec3 H = normalize(Ls + V); float NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
    vec3 F = f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
    vec3 spec = ggxD(NoH, aS) * visSG(NoV, nls, aS) * F * (a * a) / (aS * aS);
    // the four towers that cast throw this point into shadow where a caster stands between
    float sh = (uLSh[i] >= 0 && uLSh[i] < uSpotN) ? spotShadow(uLSh[i], vPos + N * 0.04) : 1.0;
    vec3 rad = uLCol[i] * spotOf(i, L, far ? 0.012 : 0.05) * mix(sh, 1.0, 0.08) * (far ? exp(-max(d - 700.0, 0.0) / 240.0) : floodAtt(i, d));
    // past the field: a narrower beam and the inverse square, so the faces toward the park catch
    // some light and no more
    if (far) rad *= smoothstep(0.80, 0.97, dot(-L, uLDir[i])) * 0.9 + 0.12 * min(1.0, pow(260.0 / d, 2.0));
    col += (dif / PI * wd * (vMat == ${MAT.GROUND} ? 0.45 + 0.55 * ao : 1.0) + spec * nls) * rad;
    // light through skin: a warm wrap past the terminator
    if (vMat == ${MAT.SKIN} || vMat == ${MAT.HEAD} || vMat == ${MAT.EAR} || vMat == ${MAT.NECK}) col += alb * vec3(0.10, 0.025, 0.01) * max(wd - nl, 0.0) * rad;
  }
  // the low sun before it sets (diamond/sky.js sunLight), shadowed by the bowl, its roof and the
  // players through its own map over the whole park (uSunSh), or unshadowed with none
  if (uSunCol.r + uSunCol.g + uSunCol.b > 0.0) {
    vec3 L = uSunDir; float NoL = dot(N, L);
    float wd = max((NoL + wrap) / (1.0 + wrap), 0.0), nl = max(NoL, 0.0);
    vec3 H = normalize(L + V); float NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
    vec3 F = f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
    float sh = uSunSh >= 0 ? spotShadow(uSunSh, vPos + N * 0.3) : 1.0;
    vec3 rad = uSunCol * sh;
    col += (dif / PI * wd + ggxD(NoH, a) * visSG(NoV, nl, a) * F * nl) * rad;
    if (vMat == ${MAT.SKIN} || vMat == ${MAT.HEAD} || vMat == ${MAT.EAR} || vMat == ${MAT.NECK}) col += alb * vec3(0.10, 0.025, 0.01) * max(wd - nl, 0.0) * rad;
  }
  // cloth has a sheen at grazing angles
  if (vMat == ${MAT.CLOTH}) col += dif * pow(1.0 - NoV, 4.0) * 0.05 * uSkyUp;
  if (uBlobN > 0 && vMat == ${MAT.GROUND}) col *= blobAt(vPos);
  // what lights itself: windows, the concourse, the floods at the wall's foot, the glass of the roof
  col += emis * uCityLit;
  o = vec4(airOf(col, vPos), uAlpha * tex.a);
}`;

// The crowd's vertex shader is gl/crowd.js's: each fan sits, stands or cheers by how loud his side
// is. Its fragment shader lights him as the park is lit.
const CROWD_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vN; in vec3 vAlb;
out vec4 o;
${LIGHTS_GLSL}
${SPOT_SHADOW_GLSL}
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform int uSunSh;
void main() {
  vec3 N = normalize(vN);
  vec3 col = vAlb * mix(belowAt(vPos), uSkyUp, N.y * 0.5 + 0.5) * 0.5;
  // the low sun on the stands it reaches, the rest in the bowl's shadow
  if (uSunCol.r + uSunCol.g + uSunCol.b > 0.0) {
    float sh = uSunSh >= 0 ? spotShadow(uSunSh, vPos + N * 0.3) : 1.0;
    col += vAlb / PI * max(dot(N, uSunDir) * 0.8 + 0.2, 0.0) * uSunCol * sh * 0.8;
  }
  for (int i = 0; i < 6; i++) {
    vec3 Lv = lampVec(i, vPos); float d = length(Lv); vec3 L = Lv / d;
    col += vAlb / PI * max(dot(N, L) * 0.8 + 0.2, 0.0) * uLCol[i] * spotOf(i, L, 0.04) * 0.55 * (uFlood > 0.5 ? floodAtt(i, d) : 1.0);
  }
  o = vec4(airOf(col, vPos), 1.0);
}`;

// A far fan as a card (gl/crowd.js CARD_VS): his outline drawn from the point on the card in
// feet (vQ, x across from his middle, y up from his seat's tread): his head with his hair or cap on
// top, his shoulders and body in his shirt, his trousers below, and his arms up when he cheers.
// Lit as the crowd is lit.
const CARD_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vN; in vec2 vQ;
flat in vec3 vShirt; flat in vec3 vSkin; flat in vec3 vHair; flat in float vK; flat in float vH;
out vec4 o;
${LIGHTS_GLSL}
void main() {
  float x = abs(vQ.x), y = vQ.y, hc = vH - 0.33;
  vec3 alb;
  float dh = length(vec2(vQ.x, (y - hc) * 0.88));
  float sh = vH - 0.72, hip = vH - (vK < 0.5 ? mix(1.95, 2.25, vK * 2.0) : 2.25);
  float arm = vK > 0.5 ? (vK - 0.5) * 2.0 : 0.0;
  if (dh < 0.27) alb = y > hc + 0.06 ? vHair : vSkin;
  else if (y < sh && y > hip && x < mix(0.5, 0.36, smoothstep(sh - 0.3, hip, y))) alb = vShirt;
  else if (y <= hip && x < 0.36) alb = vec3(0.05, 0.05, 0.08);
  else if (arm > 0.0 && abs(x - 0.5) < 0.09 && y > sh - 0.1 && y < sh + 1.7 * arm) alb = y > sh + 1.7 * arm - 0.22 ? vSkin : vShirt;
  else discard;
  vec3 N = normalize(vN);
  vec3 col = alb * mix(belowAt(vPos), uSkyUp, N.y * 0.5 + 0.5) * 0.5;
  for (int i = 0; i < 6; i++) {
    vec3 Lv = lampVec(i, vPos); float d = length(Lv); vec3 L = Lv / d;
    col += alb / PI * max(dot(N, L) * 0.8 + 0.2, 0.0) * uLCol[i] * spotOf(i, L, 0.04) * 0.55 * (uFlood > 0.5 ? floodAtt(i, d) : 1.0);
  }
  o = vec4(airOf(col, vPos), 1.0);
}`;

// A full-screen triangle with no vertex buffer, as hdr.js draws its passes.
const FULL_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
// The sky: horizon to zenith, warmer toward where the sun went down, the city's glow low down, and
// a few stars once it's dark.
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform mat4 uInvVP; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uHorAway; uniform vec3 uSunDir; uniform vec3 uGlow; uniform float uStars;
${LIGHTS_GLSL}
void main() {
  vec4 p = uInvVP * vec4(vUV * 2.0 - 1.0, 1.0, 1.0); vec3 rd = normalize(p.xyz / p.w - uEye);
  float el = rd.y, fl = length(rd.xz);
  // the horizon toward where the sun went down, and away from it (the same at night)
  float f = fl > 1e-4 ? dot(rd.xz / fl, uSunDir.xz) * 0.5 + 0.5 : 0.5;
  vec3 col = mix(mix(uHorAway, uHor, f * f), uZen, smoothstep(-0.02, 0.55, el)) + uGlow * exp(-max(el, 0.0) * 12.0);
  vec3 q = floor(rd * 520.0); float h = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  col += vec3(step(0.9982, h)) * 0.06 * smoothstep(0.05, 0.35, el) * uStars;
  // the sky is a long way off through the same air: the haze at the horizon, the towers' glow
  o = vec4(airOf(col, uEye + rd * 4000.0), 1.0);
}`;
// The last pass: the bloom added in linear light, the filmic curve, and the encode.
const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uScene; uniform sampler2D uB0; uniform sampler2D uB1;
uniform float uBloom; uniform float uExp;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 oetf(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 c = texture(uScene, vUV).rgb + (texture(uB0, vUV).rgb + texture(uB1, vUV).rgb) * uBloom;
  o = vec4(oetf(aces(max(c, 0.0) * uExp)), 1.0);
}`;

// The Curtain round the city, with gl/curtain.js's own look over the park's frame: pos3, uv2 (0..1
// along a panel, 0 at the crown to 1 at the ground), its strength and the lockdown's red.
const CURTAIN_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec2 aUV; layout(location = 2) in float aAlpha; layout(location = 3) in float aRed;
uniform mat4 uVP;
out vec2 vUV; out float vAlpha; out float vRed;
void main() { vUV = aUV; vAlpha = aAlpha; vRed = aRed; gl_Position = uVP * vec4(aPos, 1.0); }`;

for (const [vs, fs] of [[LIT_VS, LIT_FS], [SKIN_VS, LIT_FS], [SKIN_DEPTH_VS, DEPTH_FS], [STATIC_DEPTH_VS, DEPTH_FS], [CROWD_VS, CROWD_FS], [CARD_VS, CARD_FS], [FULL_VS, SKY_FS], [FULL_VS, FINAL_FS], [CURTAIN_VS, CURTAIN_FRAG]]) declareProgram(vs, fs);

// The textures whose clear texels are holes: the wall's distances, the monograms, the masks' bars.
const ALPHA_TEST = new Set(['nums', 'logo', 'mask', 'finalLogo']);

// The night the park was tuned at, and the park's light at any hour (diamond/sky.js): the sky's
// colours, its ambient, how hard the towers burn, the air, the city's windows and lamps.


// ── textures, painted on canvases ───────────────────────────────────────────
// Value noise at several scales into the channels: fine blades in R, the macro mottle in G,
// pure grain in B. Tiled, so the field samples it at three scales without a seam.
function noiseCanvas(doc, n, seed, f) {
  const c = doc.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data;
  let s = seed >>> 0;
  const r = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lattice = (k) => { const a = new Float32Array(k * k); for (let i = 0; i < a.length; i++) a[i] = r(); return a; };
  const sample = (a, k, u, v) => {
    const fx = u * k, fy = v * k, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const x0 = ix % k, x1 = (ix + 1) % k, y0 = (iy % k) * k, y1 = ((iy + 1) % k) * k;
    return (a[y0 + x0] * (1 - sx) + a[y0 + x1] * sx) * (1 - sy) + (a[y1 + x0] * (1 - sx) + a[y1 + x1] * sx) * sy;
  };
  const g8 = lattice(8), g16 = lattice(16), g32 = lattice(32), g64 = lattice(64);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n, fine = r();
    const blade = 0.55 * fine + 0.25 * sample(g64, 64, u, v) + 0.2 * sample(g32, 32, u, v);
    const macro = 0.5 * sample(g8, 8, u, v) + 0.3 * sample(g16, 16, u, v) + 0.2 * sample(g32, 32, u, v);
    const out = f ? f(fine, macro) : [blade, macro, fine], k = (y * n + x) * 4;
    d[k] = out[0] * 255; d[k + 1] = out[1] * 255; d[k + 2] = out[2] * 255; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
function canvasOf(doc, w, h, paint) { const c = doc.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); return c; }
// The wall padding: dark green, a lighter top edge, a yellow line along the top.
const padCanvas = (doc) => canvasOf(doc, 512, 256, (g) => {
  g.fillStyle = '#163d2f'; g.fillRect(0, 0, 512, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, 'rgba(255,255,255,0.06)'); grd.addColorStop(1, 'rgba(0,0,0,0.12)'); g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, 4, 256); g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(4, 0, 2, 256);
  g.fillStyle = '#e8c73a'; g.fillRect(0, 0, 512, 10);
});
// Four seats to a tile, blue on grey.
const seatCanvas = (doc) => canvasOf(doc, 256, 64, (g) => {
  g.fillStyle = '#3d4650'; g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 4; i++) { g.fillStyle = '#2d5f7d'; g.fillRect(i * 64 + 6, 8, 52, 40); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(i * 64 + 6, 44, 52, 6); }
});
// A final's logo, painted on the grass (ballpark-mesh.js buildDress): its name in gold on a navy
// roundel ringed in gold, and ONE GAME under it, on a clear ground.
const finalLogoCanvas = (doc, name) => canvasOf(doc, 1024, 512, (g) => {
  g.clearRect(0, 0, 1024, 512);
  g.fillStyle = '#16264a'; g.strokeStyle = '#e2b13c'; g.lineWidth = 26;
  g.beginPath(); g.ellipse(512, 256, 480, 220, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.lineWidth = 6; g.strokeStyle = '#f4efe0';
  g.beginPath(); g.ellipse(512, 256, 440, 186, 0, 0, Math.PI * 2); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const words = String(name || 'Final').toUpperCase();
  let px = 150;
  g.font = HUD_FACES.big(px);
  while (px > 40 && g.measureText(words).width > 780) { px -= 6; g.font = HUD_FACES.big(px); }
  g.lineWidth = 10; g.strokeStyle = '#0b1220'; g.strokeText(words, 512, 236);
  g.fillStyle = '#ffd75c'; g.fillText(words, 512, 236);
  g.font = HUD_FACES.label(54); g.fillStyle = '#f4efe0'; g.fillText('ONE GAME', 512, 352);
});
// The ads round the front of the lower bowl behind the plate, four to a repeat.
const adsCanvas = (doc, ads) => canvasOf(doc, 2048, 128, (g) => {
  const list = (ads && ads.length ? ads : ['', '', '', '']).slice(0, 4);
  while (list.length < 4) list.push(list[list.length % Math.max(1, ads?.length || 1)] || '');
  const inks = ['#f5d24a', '#ffffff', '#9fd8e0', '#f5d24a'];
  list.forEach((t, i) => {
    g.fillStyle = i % 2 ? '#22355e' : '#1b2a4b'; g.fillRect(i * 512, 0, 512, 128);
    if (!t) return;
    g.fillStyle = inks[i]; g.font = `italic bold 70px ${FACE}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(i * 512 + 256, 66); g.scale(0.9, 1); g.fillText(String(t).toUpperCase(), 0, 0, 470); g.restore();
  });
});
// The wall's distances, a cell each, white on clear.
const numsCanvas = (doc, texts) => canvasOf(doc, 1024, 128, (g) => {
  g.clearRect(0, 0, 1024, 128);
  g.font = `bold 104px ${FACE}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f2f0e6';
  texts.forEach((t, i) => g.fillText(t, i * 256 + 128, 68, 240));
});
// The backstop's mesh.
const netCanvas = (doc) => canvasOf(doc, 128, 128, (g) => {
  g.clearRect(0, 0, 128, 128); g.strokeStyle = 'rgba(30,30,30,1)'; g.lineWidth = 3;
  for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
});

// ── the name plates ─────────────────────────────────────────────────────────
// The two plates over the Coliseum's gates and the name band beside them (ballpark-mesh.js
// PLATE_ATLAS), painted as the map makes them (glass/models/coliseum.js, sections 6 and 8). The main
// gate's plate is the Meridian's standard: dark bronze, a double gilt fillet and GRANDSTAND in raised
// gilt in the deco hand, every letter catching the light along its top and casting its shadow down
// and to the right onto the bronze. The bleacher gate's says BLEACHERS inside a single fillet. Every
// measure is the map's, in its tiles, across the plate's own width and height. The venue's name is
// cut into the band in one line, the reverse of the plates' gilt: the cut's upper wall in shadow up
// and left, its lower lip catching the light down and right, and the cut over both.
// ⚠ NOTHING IS EVER SQUEEZED. A line too long for its band is set smaller, never narrower: a
// squeezed name read as a different hand from the map's.
export const DECO_FACE = (px) => `${Math.round(px)}px Limelight, "Copperplate Gothic Bold", Copperplate, "Sitka Banner", Optima, "Palatino Linotype", serif`;
let decoP = null;
export function loadDecoFace(doc) {
  if (decoP) return decoP;
  if (!doc?.fonts || typeof FontFace === 'undefined') return (decoP = Promise.resolve(false));
  decoP = new FontFace('Limelight', 'url(' + new URL('../../../../shared/fonts/limelight.woff2', import.meta.url).href + ')').load()
    .then((f) => { doc.fonts.add(f); return true; }, () => false);
  return decoP;
}
// The line the venue's name is cut in: all of it, in capitals, as the map's band has it.
export function bandLine(name) {
  return (String(name || '').trim() || 'Charles B. Hughson Coliseum').toUpperCase().split(/\s+/).join(' ');
}
// The band's stone and its cut, over the stone's grey (BAND_STONE, ballpark-mesh.js): the shadowed
// wall, the cut's floor and the lit lip, paler than the stone round it.
const CUT = Object.freeze({ deep: 'rgb(46,46,46)', cut: 'rgb(112,112,112)', lip: 'rgb(255,255,255)' });
export function paintPlateCanvas(doc, name) {
  const A = PLATE_ATLAS;
  return canvasOf(doc, A.w, A.h, (g) => {
    g.clearRect(0, 0, A.w, A.h);
    // one plate into its cell: `pw`, `ph` its width and height in the map's tiles
    const plate = ([cx, cy, cw, ch], pw, ph, paint) => {
      const sx = cw / pw, sy = ch / ph;
      g.save(); g.translate(cx, cy);
      // the bronze, darker toward its edges, with a fine grain along it
      const grd = g.createLinearGradient(0, 0, 0, ch);
      grd.addColorStop(0, '#17110b'); grd.addColorStop(0.5, '#2a1f15'); grd.addColorStop(1, '#130e09');
      g.fillStyle = grd; g.fillRect(0, 0, cw, ch);
      g.globalAlpha = 0.06; g.fillStyle = '#d8b07a';
      for (let y = 3; y < ch; y += 7) g.fillRect(0, y, cw, 1);
      g.globalAlpha = 1;
      paint(sx, sy, cw, ch);
      g.restore();
    };
    // gilt: the light along its top, its face, and the shadow it casts down and right
    const giltFill = (y0, y1) => { const f = g.createLinearGradient(0, y0, 0, y1); f.addColorStop(0, '#fbe7ae'); f.addColorStop(0.45, '#ecc97e'); f.addColorStop(1, '#b4873c'); return f; };
    const giltRect = (x, y, w, h, d) => {
      g.fillStyle = 'rgba(10,6,2,0.85)'; g.fillRect(x + d, y + d, w, h);
      g.fillStyle = 'rgba(255,244,210,0.6)'; g.fillRect(x - d * 0.35, y - d * 0.35, w, h);
      g.fillStyle = giltFill(y, y + h); g.fillRect(x, y, w, h);
    };
    // the size a line is set at to fill x0..x1 by y0..y1, as large as it allows without squeezing
    const fit = (text, bw, bh, k) => {
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      let px = bh / 0.7;
      g.font = DECO_FACE(px);
      const m = g.measureText?.(text);
      const cap = m && m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent / px : 0.7;
      px = Math.min(px, (bh * k) / cap);
      g.font = DECO_FACE(px);
      const w = g.measureText?.(text)?.width || 0;
      if (w > bw * 0.97) { px *= (bw * 0.97) / w; g.font = DECO_FACE(px); }
      return { px, cap };
    };
    // a line of raised gilt letters, centred in its band
    const letters = (text, x0, x1, y0, y1) => {
      const { px, cap } = fit(text, x1 - x0, y1 - y0, 0.84);
      const cx = (x0 + x1) / 2, base = (y0 + y1) / 2 + (cap * px) / 2, d = Math.max(2, px * 0.045);
      g.fillStyle = 'rgba(10,6,2,0.85)'; g.fillText(text, cx + d, base + d * 1.2);
      g.fillStyle = 'rgba(255,244,210,0.6)'; g.fillText(text, cx - d * 0.35, base - d * 0.35);
      g.fillStyle = giltFill(base - cap * px, base); g.fillText(text, cx, base);
    };

    // THE MAIN GATE: GRANDSTAND, where it lets you in. The plate is 0.33 by 0.09 tiles; its double
    // fillet a gilt border 0.0055 in and a fine line 0.0024 wide 0.012 in; the letters 0.141 either
    // side of the middle, from 0.004 inside the fine line at the foot to 0.004 inside it at the top.
    const MP = MAIN_PLATE;
    plate(A.main, 2 * MP.hw, MP.z1 - MP.z0, (sx, sy, cw, ch) => {
      const ft = 0.0055, inn = 0.012, lt = 0.0024, d = 3;
      giltRect(0, 0, cw, ft * sy, d); giltRect(0, ch - ft * sy, cw, ft * sy, d);
      giltRect(0, 0, ft * sx, ch, d); giltRect(cw - ft * sx, 0, ft * sx, ch, d);
      giltRect(inn * sx, inn * sy, cw - 2 * inn * sx, lt * sy, 2); giltRect(inn * sx, ch - inn * sy - lt * sy, cw - 2 * inn * sx, lt * sy, 2);
      giltRect(inn * sx, inn * sy, lt * sx, ch - 2 * inn * sy, 2); giltRect(cw - inn * sx - lt * sx, inn * sy, lt * sx, ch - 2 * inn * sy, 2);
      const Y = (z) => (MP.z1 - z) * sy, X = (du) => cw / 2 + du * sx, hw = MP.hw - 0.024;
      letters('GRANDSTAND', X(-hw), X(hw), Y(MP.z1 - inn - 0.004), Y(MP.z0 + inn + 0.004));
    });
    // THE BLEACHER GATE: BLEACHERS inside a single fillet, on a plate 0.30 by 0.085 tiles
    plate(A.bleach, 0.30, 0.085, (sx, sy, cw, ch) => {
      const ft = 0.005, d = 3;
      giltRect(0, 0, cw, ft * sy, d); giltRect(0, ch - ft * sy, cw, ft * sy, d);
      giltRect(0, 0, ft * sx, ch, d); giltRect(cw - ft * sx, 0, ft * sx, ch, d);
      letters('BLEACHERS', cw / 2 - 0.125 * sx, cw / 2 + 0.125 * sx, 0.016 * sy, ch - 0.016 * sy);
    });
    // THE NAME BAND on each face: the whole run in two cells, the reader's left first, the line set
    // once across both and each cell showing its half. As wide as the run allows inside 0.05 tiles at
    // each end, as the map's is, and its capitals never taller than 0.78 of the band.
    const line = bandLine(name);
    for (const k of ['s', 'n']) {
      const cells = A.band[k], cw = cells[0][2], ch = cells[0][3], W = 2 * cw, len = BAND_RUNS[k][1] - BAND_RUNS[k][0];
      const m = 0.05 * (W / len), { px, cap } = fit(line, W - 2 * m, ch, 0.78);
      const cx = W / 2, base = ch / 2 + (cap * px) / 2, d = Math.max(1.5, cap * px * 0.022);
      cells.forEach(([x, y], i) => {
        g.save(); g.beginPath(); g.rect(x, y, cw, ch); g.clip(); g.translate(x - i * cw, y);
        g.fillStyle = `rgb(${BAND_STONE},${BAND_STONE},${BAND_STONE})`; g.fillRect(i * cw, 0, cw, ch);
        g.fillStyle = CUT.deep; g.fillText(line, cx - d, base - d);
        g.fillStyle = CUT.lip; g.fillText(line, cx + d * 1.25, base + d * 1.2);
        g.fillStyle = CUT.cut; g.fillText(line, cx, base);
        g.restore();
      });
    }
  });
}

// The painted canvases are the same for every park and every mount: made once a document.
const _canvases = new WeakMap();
function sharedCanvases(doc) {
  let c = _canvases.get(doc);
  if (!c) {
    c = {
      grass: noiseCanvas(doc, 512, 3),
      concrete: noiseCanvas(doc, 256, 12, (fine, macro) => { const b = 0.46 + 0.10 * macro + 0.06 * fine; return [b, b * 0.98, b * 0.95]; }),
      dirt: paintInfield(doc), pad: padCanvas(doc), seat: seatCanvas(doc), net: netCanvas(doc),
    };
    _canvases.set(doc, c);
  }
  return c;
}

// The park's geometry for a venue: built once a venue.
const _parks = new Map();
function parkFor(venue) {
  const key = JSON.stringify(venue || null);
  let p = _parks.get(key);
  if (!p) { p = buildPark(venue); _parks.set(key, p); if (_parks.size > 4) _parks.delete(_parks.keys().next().value); }
  return p;
}

export function createBallparkRenderer(canvas, opts = {}) {
  const doc = canvas.ownerDocument;
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: true,
      powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  } catch { gl = null; }
  if (!gl) return null;
  try { return build(); } catch (err) { console.warn('[ballpark] GLASS 2 park unavailable, drawing in 2-D:', err && err.message); return null; }

  function build() {
    prewarmPrograms(gl);
    const hdr = createHDRLayer(gl);
    if (!hdr) return null;
    // ⚠ THE SHADOW MAPS ARE NOT OPTIONAL. The lit shader declares four shadow samplers, and WebGL2
    // refuses a draw whose shadow sampler reads a texture with no compare mode, or shares a unit
    // with an ordinary sampler. So the maps always exist (a 1×1 set if a full one won't allocate)
    // and are always bound, and `uSpotN` says how many hold anything this frame.
    const shadows = createSpotShadows(gl) || createSpotShadows(gl, { size: 1 });
    if (!shadows) return null;
    const ssao = createDepthSSAO(gl);
    const bc = createBroadcastPass(gl);
    const prog = (vs, fs) => {
      let p = takeWarm(gl, vs, fs);
      if (!p) {
        p = gl.createProgram();
        for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
          const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('ballpark shader: ' + gl.getShaderInfoLog(sh));
          gl.attachShader(p, sh); gl.deleteShader(sh);
        }
        gl.linkProgram(p);
      }
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('ballpark link: ' + gl.getProgramInfoLog(p));
      const u = {};
      return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) };
    };
    const LIT = prog(LIT_VS, LIT_FS), CROWD = prog(CROWD_VS, CROWD_FS), CARD = prog(CARD_VS, CARD_FS), SKY = prog(FULL_VS, SKY_FS), FINAL = prog(FULL_VS, FINAL_FS);
    const CURT = prog(CURTAIN_VS, CURTAIN_FRAG);
    const SKLIT = prog(SKIN_VS, LIT_FS), SKD = prog(SKIN_DEPTH_VS, DEPTH_FS), STD = prog(STATIC_DEPTH_VS, DEPTH_FS);
    const spectacle = createSpectacle(gl, prog);
    const weather = createWeather(gl, prog);
    const cityLights = createCityLights(gl, prog);
    const streets = createStreetLife(gl, prog);
    const birds = createParkBirds(gl, prog);

    // ── textures ──────────────────────────────────────────────────────────────
    const T2 = gl.TEXTURE_2D;
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const maxAniso = aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    // A colour texture is sRGB, so sampling it gives linear light; a data texture isn't.
    function texture(src, { srgb = true, repeat = true, premul = false, af = 8 } = {}) {
      const t = gl.createTexture();
      gl.bindTexture(T2, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);
      gl.texImage2D(T2, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(T2);
      gl.texParameteri(T2, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(T2, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(T2, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(T2, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      if (aniso) gl.texParameterf(T2, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(af, maxAniso));
      return t;
    }
    const park = parkFor(opts.venue);
    const shared = sharedCanvases(doc);
    const TEX = {
      grass: texture(shared.grass, { srgb: false }),
      dirt: texture(shared.dirt, { repeat: false, premul: true, af: 16 }),
      pad: texture(shared.pad), concrete: texture(shared.concrete), seat: texture(shared.seat), net: texture(shared.net),
      ads: texture(adsCanvas(doc, opts.ads)), nums: texture(numsCanvas(doc, park.numbers), { repeat: false }),
      leather: texture(paintLeather(doc)), wood: texture(paintWood(doc), { repeat: false }), mask: texture(paintMask(doc), { repeat: false }),
    };
    // The kit atlas and the monograms are the cast's, painted when it changes. ⚠ The atlas stops
    // its mips at 16 texels a slot, past which neighbouring jerseys would bleed into each other.
    let kits = null;
    TEX.kit = gl.createTexture();
    gl.bindTexture(T2, TEX.kit);
    gl.texStorage2D(T2, 6, gl.SRGB8_ALPHA8, 2048, 2048);
    gl.texParameteri(T2, gl.TEXTURE_MAX_LEVEL, 5);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(T2, k, v);
    if (aniso) gl.texParameterf(T2, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
    let logoKey = '';
    // The faces: the street figure's atlas of masks (actor-faces.js), loaded once. Until it's here a
    // neutral texel stands in, plain skin with no features.
    TEX.faces = gl.createTexture();
    gl.bindTexture(T2, TEX.faces);
    gl.texImage2D(T2, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([170, 0, 0, 255]));
    gl.texParameteri(T2, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(T2, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    loadFaces();
    function loadFaces() {
      const Img = doc.defaultView && doc.defaultView.Image;
      if (!Img) return;
      const img = new Img();
      img.onload = () => {
        if (lost) return;
        gl.bindTexture(T2, TEX.faces);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(T2, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
        gl.texParameteri(T2, gl.TEXTURE_MAX_LEVEL, FACE_ATLAS.maxLevel);
        gl.generateMipmap(T2);
        gl.texParameteri(T2, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(T2, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(T2, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (aniso) gl.texParameterf(T2, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
        opts.onAsset?.();
      };
      img.src = new URL('../../../assets/actor-faces.png', import.meta.url).href;
    }
    // the scoreboard's lamps, one byte each
    const boardTex = gl.createTexture();
    gl.bindTexture(T2, boardTex);
    gl.texParameteri(T2, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(T2, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(T2, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(T2, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    function setBoard(state) {
      gl.bindTexture(T2, boardTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(T2, 0, gl.R8, BOARD_W, BOARD_H, 0, gl.RED, gl.UNSIGNED_BYTE, boardLamps(state));
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    }
    setBoard({});

    // ── geometry, once ────────────────────────────────────────────────────────
    const LIT_ATTRS = [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 3, 32], [4, 1, 44]];
    const upload = (b) => {
      const vao = gl.createVertexArray(), st = makeVertexStream(gl, vao, STRIDE, LIT_ATTRS);
      st.write(b.data, b.n * STRIDE);
      return { vao, n: b.n, st };
    };
    const opaque = [...park.opaque].map(([key, b]) => ({ key, ...upload(b) }));
    const translucent = [...park.translucent].map(([key, b]) => ({ key, ...upload(b) }));
    // what burns on its own (the towers' floods, the decks' rows, the beacons, the gates' lanterns and
    // the plates' halo), each at its own strength a frame; and the roof's shells, each drawn where
    // the roof has got to (ballpark-mesh.js shellShift)
    const lampDraws = Object.entries(park.lamps).filter(([, b]) => b.n).map(([kind, b]) => ({ key: 'lamp', kind, emis: 1, ...upload(b) }));
    const shells = park.roof.map((r, i) => ({ key: 'shell', i, fixed: r.fixed, ...upload(r.batch) }));
    // the crowd: one figure in its three poses (ballpark-mesh.js crowdMorph), drawn once for the fans
    // who rest sitting, once standing and once cheering, each getting up as his side roars. Each
    // kind's fans are dealt into a seeded order, so a tier that draws fewer (its `crowd`) draws the
    // first of them and thins every stand evenly, rather than emptying the back rows.
    // A final sells every seat and hands out rally towels (setFinal): the same build, from the park
    // built full, with the towel in every cheering fan's hand.
    const dealt = Object.fromEntries(['sit', 'stand', 'cheer'].map((kind) => [kind, dealFans(park.crowd[kind] || new Float32Array(0), CROWD_STRIDE)]));
    const cardQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cardQuad); gl.bufferData(gl.ARRAY_BUFFER, CARD_QUAD, gl.STATIC_DRAW);
    const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    // Each kind has a second VAO over the same fans with the figure's near level (456 triangles to
    // the far's 256), drawn when the shot's lens is long enough to bring the stands up close
    // (quality.fans 2, CLOSE_FOV).
    const crowdOf = (src, towels) => {
      const list = [];
      const morphs = [crowdMorph({ far: opts.crowd !== 'near', towels }), crowdMorph({ far: false, towels })];
      const mbs = morphs.map((morph) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, morph, gl.STATIC_DRAW); return b; });
      const deal = src === park.crowd ? dealt : Object.fromEntries(['sit', 'stand', 'cheer'].map((kind) => [kind, dealFans(src[kind] || new Float32Array(0), CROWD_STRIDE)]));
      for (const [base, kind] of ['sit', 'stand', 'cheer'].entries()) {
        const inst = deal[kind];
        if (!inst.length) continue;
        const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
        const vaos = mbs.map((mb) => {
          const vao = gl.createVertexArray();
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, mb);
          const VS = CROWD_MORPH * 4;
          for (const [loc, size, off] of [[0, 3, 0], [1, 3, 12], [2, 3, 24], [6, 3, 36], [7, 3, 48], [8, 3, 60], [9, 1, 72]]) {
            gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, VS, off);
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, ib);
          const IS = CROWD_STRIDE * 4;
          gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, IS, 0); gl.vertexAttribDivisor(3, 1);
          gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, IS, 16); gl.vertexAttribDivisor(4, 1);
          gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 3, gl.FLOAT, false, IS, 32); gl.vertexAttribDivisor(5, 1);
          gl.bindVertexArray(null);
          return vao;
        });
        // the far fans as cards (CARD_VS): the card's corners, and an instance buffer of its own the
        // split fills (splitCrowd)
        const cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
        const cardVao = gl.createVertexArray();
        gl.bindVertexArray(cardVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, cardQuad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, cb);
        const IS = CROWD_STRIDE * 4;
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, IS, 0); gl.vertexAttribDivisor(3, 1);
        gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, IS, 16); gl.vertexAttribDivisor(4, 1);
        gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 3, gl.FLOAT, false, IS, 32); gl.vertexAttribDivisor(5, 1);
        gl.bindVertexArray(null);
        list.push({ vao: vaos[0], near: vaos[1], cardVao, base, n: morphs[0].length / CROWD_MORPH, nNear: morphs[1].length / CROWD_MORPH, count: inst.length / CROWD_STRIDE,
          src: inst, ib, cb, figs: null, cards: 0, buffers: [ib, cb] });
      }
      list.mbs = mbs;
      return list;
    };
    const dropCrowd = (list) => { for (const d of list) { gl.deleteVertexArray(d.vao); gl.deleteVertexArray(d.near); gl.deleteVertexArray(d.cardVao); for (const b of d.buffers) gl.deleteBuffer(b); } for (const b of list.mbs) gl.deleteBuffer(b); };
    // Which fans are drawn as cards (quality.cards): every one the tier draws who stands less than
    // CARD_PX device pixels tall on the screen, worked out again when the camera has moved enough
    // (the split's key: where it is and looks, rounded, its lens, the frame's height and the tier's
    // share of the fans) and at most every CARD_EVERY ms. The figures' instance buffer then holds the
    // rest, nearest the camera, and the cards' buffer the far ones. A fan's height is FAN_H feet.
    const CARD_PX = 9, CARD_EVERY = 250, FAN_H = 5;
    let splitAt = -Infinity;
    function splitCrowd(list, M, h, share) {
      const r = (v, k) => Math.round(v / k);
      const key = [r(M.eye[0], 4), r(M.eye[1], 4), r(M.eye[2], 4), r(M.at[0], 8), r(M.at[1], 8), r(M.at[2], 8), r(M.fov, 0.5), h, share].join();
      if (list.splitKey === key) return;
      const now = clock();
      if (list.splitKey && now - splitAt < CARD_EVERY) return;
      splitAt = now; list.splitKey = key;
      const f = norm3([M.at[0] - M.eye[0], M.at[1] - M.eye[1], M.at[2] - M.eye[2]]), k0 = (h / 2) / Math.tan(M.fov * Math.PI / 360) * FAN_H;
      for (const d of list) {
        const n = Math.round(d.count * share), S = CROWD_STRIDE;
        if (!d.figArr) { d.figArr = new Float32Array(d.src.length); d.cardArr = new Float32Array(d.src.length); }
        let nf = 0, nc = 0;
        for (let i = 0; i < n; i++) {
          const o = i * S, dx = d.src[o] - M.eye[0], dy = d.src[o + 1] - M.eye[1], dz = d.src[o + 2] - M.eye[2];
          const z = dx * f[0] + dy * f[1] + dz * f[2];
          if (z > 1 && k0 / z >= CARD_PX) d.figArr.set(d.src.subarray(o, o + S), nf++ * S);
          else d.cardArr.set(d.src.subarray(o, o + S), nc++ * S);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, d.ib); gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.figArr, 0, nf * S);
        gl.bindBuffer(gl.ARRAY_BUFFER, d.cb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.cardArr, 0, nc * S);
        d.figs = nf; d.cards = nc;
      }
    }
    // the cards off: the figures' buffer back to every fan in his dealt order
    function unsplitCrowd(list) {
      if (!list.splitKey) return;
      list.splitKey = null;
      for (const d of list) { gl.bindBuffer(gl.ARRAY_BUFFER, d.ib); gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.src); d.figs = null; d.cards = 0; }
    }
    // a lens this long or longer (degrees) brings the stands up close enough for the near figure
    const CLOSE_FOV = 20;
    const homeCrowd = crowdOf(park.crowd, !!opts.towels);
    let crowd = homeCrowd, fullCrowd = null;
    // how loud each side's fans are (gl/crowd.js createRoar), the clock their bouncing keeps, and
    // whether they may bounce at all
    const roar = { home: 0, away: 0, t: 0, move: 1 };
    // Where the fans look (gl/crowd.js uLook): the ball while there is one, eased toward it over
    // about half a second so a throw turns the stands rather than snapping them, and the mound
    // with less hold on them when there isn't. Eased on the clock the crowd is drawn at; a jump in
    // it starts the look over.
    const crowdLook = { x: 0, z: 60, w: 0.35, t: null };
    function lookAtPlay(t) {
      const want = ballAt ? { x: ballAt[0], z: ballAt[2], w: 1 } : { x: 0, z: 60, w: 0.35 };
      const dt = crowdLook.t == null ? Infinity : t - crowdLook.t;
      const k = !(dt >= 0) || dt > 1 ? 1 : 1 - Math.exp(-dt * 4);
      crowdLook.x += (want.x - crowdLook.x) * k; crowdLook.z += (want.z - crowdLook.z) * k; crowdLook.w += (want.w - crowdLook.w) * k;
      crowdLook.t = t;
    }
    // where every fan sits, which way he faces and the pose he rests in (0 sit, 1 stand, 2 cheer),
    // for the camera flashes in the crowd at night (gl/crowd.js flashesAt): a small hard point of
    // light in front of his face, seated or up as the roar has him, never for a viewer who's asked
    // for less motion, and drawn with the city's lights
    const seats = (() => {
      const out = [];
      ['sit', 'stand', 'cheer'].forEach((kind, base) => { const a = dealt[kind]; for (let i = 0; i < a.length; i += CROWD_STRIDE) out.push(a[i], a[i + 1], a[i + 2], a[i + 3], base); });
      return new Float32Array(out);
    })();
    // the fans drawn at the tier's share, and the seat of the i-th of them
    const crowdShare = () => Math.max(0, Math.min(1, api.quality.crowd ?? 1));
    const seatOf = (i, share) => {
      let first = 0;
      for (const d of crowd) {
        const n = Math.round(d.count * share);
        if (i < n) return first + i;
        i -= n; first += d.count;
      }
      return -1;
    };
    const FACE_Y = [3.8, 5.4];
    const flashBuf = new Float32Array(LIGHT_STRIDE.pts * 4);
    function flashPoints() {
      if (!roar.move || !(look.lights > 0.3) || api.quality.flashes === false) return 0;
      const loud = Math.max(roar.home, roar.away), up = Math.min(1, Math.max(0, (loud - 0.4) / 0.4)), share = crowdShare();
      const drawn = crowd.reduce((n, d) => n + Math.round(d.count * share), 0);
      let k = 0;
      for (const f of flashesAt(roar.t, loud, drawn)) {
        if (k >= 4) break;
        const s = seatOf(f.i, share);
        if (s < 0) continue;
        const o = s * 5, face = seats[o + 3], g = Math.exp(-f.age / 0.035), y = FACE_Y[0] + (FACE_Y[1] - FACE_Y[0]) * Math.max(Math.min(1, seats[o + 4]), up);
        flashBuf.set([seats[o] + Math.sin(face) * 0.7, seats[o + 1] + y, seats[o + 2] + Math.cos(face) * 0.7, 0.35, g, g, 1.1 * g, 1, 1, 0, 0, 0], k * LIGHT_STRIDE.pts);
        k++;
      }
      return k;
    }
    const emptyVao = gl.createVertexArray();

    // ── the players ───────────────────────────────────────────────────────────
    // A body per player, built once in the rig's bind pose (ballplayer-mesh.js buildBody) and
    // skinned on the GPU (gl/skin.js) into whatever pose the cast gives him. Bodies are keyed by who
    // a player is and what he wears (cast.js bodyKey), not where he stands, so a runner keeps his
    // body round the bases. Each one's pose goes into the palette's row for his kit slot, his
    // jersey's cell and face come from the same slot, and the heads' faces go into four uniform
    // arrays by slot. Bodies are built a few a frame (pump).
    const palette = createBonePalette(gl, 28);
    if (!palette) return null;
    const bodies = new Map();        // bodyKey → { batches: [{ key, vao, buf, n }] }
    let members = [];                // the cast now: [{ key, slot }]
    const roles = new Map();         // and each slot's role (cast.js), for whose knees a pitch dirties
    let queue = [];
    const HA = new Float32Array(28 * 4), HB = new Float32Array(28 * 4), HC = new Float32Array(28 * 4), HD = new Float32Array(28 * 4);
    const SKIN_ATTRS = [...LIT_ATTRS];
    function uploadSkin(b) {
      const vao = gl.createVertexArray(), buf = gl.createBuffer(), S = SKIN_STRIDE * 4;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(b.data.buffer, 0, b.n * S), gl.STATIC_DRAW);
      for (const [l, n, off] of SKIN_ATTRS) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); }
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.UNSIGNED_BYTE, false, S, STRIDE * 4);
      gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 4, gl.UNSIGNED_BYTE, true, S, STRIDE * 4 + 4);
      gl.bindVertexArray(null);
      return { vao, buf, n: b.n };
    }
    const dropBody = (body) => { for (const lv of body.levels || [body.batches]) for (const b of lv) { gl.deleteVertexArray(b.vao); gl.deleteBuffer(b.buf); } };
    // the bind frames by build scale (a pitcher stands a little taller)
    const binds = new Map();
    const bindOf = (scale) => { let b = binds.get(scale); if (!b) binds.set(scale, (b = bindFrames(scale))); return b; };
    const frames = new Float32Array(BONES.length * FRAME_FLOATS), skinBuf = new Float32Array(BONES.length * 12);
    // A pose into a slot's row of the palette: a pose table entry with `at`, `yaw` and `scale`. Its
    // joints are kept by slot for a drag mat's ropes (setMats).
    const joints = new Map();
    function setPose(slot, pose) {
      const sol = solvePose(pose);
      joints.set(slot, sol.J);
      palette.write(slot, skinRows(boneFrames(sol, frames), bindOf(pose.scale || 1), skinBuf));
    }
    // where the cast stands each man, by slot, for `idle`
    const rests = new Map();
    // Everyone nobody's posed this frame (`posed`, a Set of slots) breathes where the cast stands
    // him (diamond/anim.js breathe), so a stretch of the call that describes nothing leaves nobody
    // frozen.
    function idle(t, posed) {
      for (const [slot, rest] of rests) if (!posed.has(slot)) setPose(slot, breathe(rest, t, slot));
    }
    function setCast(cast, teams) {
      rests.clear();
      // the kits for whoever's new, and each side's monogram
      const res = paintKitAtlas(doc, cast, teams, kits);
      kits = res.canvas;
      gl.bindTexture(T2, TEX.kit);
      if (res.dirty.length) {
        for (const [x, y, w, h] of res.dirty) {
          const sub = doc.createElement('canvas'); sub.width = w; sub.height = h;
          sub.getContext('2d').drawImage(kits, x, y, w, h, 0, 0, w, h);
          gl.texSubImage2D(T2, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, sub);
        }
        gl.generateMipmap(T2);
      }
      // what each side wears (its club's kit, or the house kit): the caps' badges and the bodies'
      // colours follow it, so a club's kit arriving mid-game repaints and rebuilds its side
      const wear = kitsFor(teams);
      const lk = `${teams?.home}|${teams?.away}|${wear.home.sig}|${wear.away.sig}`;
      if (lk !== logoKey) {
        logoKey = lk;
        if (TEX.logo) gl.deleteTexture(TEX.logo);
        TEX.logo = texture(paintLogos(doc, teams), { repeat: false });
      }
      const kitOf = (c) => (c.look.role === 'ump' || c.look.role === 'crew' ? null : wear[c.look.side === 'away' ? 'away' : 'home']);
      const keyOf = (c) => { const k = kitOf(c); return k ? `${bodyKey(c)}|${k.sig}` : bodyKey(c); };
      // who stays, who goes, who's to be built
      const want = new Map(cast.map((c) => [keyOf(c), { ...c, kit: kitOf(c) }]));
      for (const [k, body] of bodies) if (!want.has(k)) { dropBody(body); bodies.delete(k); }
      queue = [...want].filter(([k]) => !bodies.has(k));
      members = cast.map((c) => ({ key: keyOf(c), slot: c.look.slot }));
      roles.clear(); for (const c of cast) roles.set(c.look.slot, c.look.role);
      HA.fill(0); HB.fill(0); HC.fill(0); HD.fill(0);
      for (const c of cast) {
        const look = lookOf({ ...c.look });
        const f = faceFor(look), i = c.look.slot * 4;
        HA.set([...f.skin, f.layout], i); HB.set([...f.hair, f.style], i); HC.set([...f.iris, f.eyeBlack], i); HD.set([...f.lip, f.seed], i);
        // each where the cast stands him, until something moves him
        const rest = Object.assign(c.mirror ? mirrorPose(POSES[c.pose]()) : POSES[c.pose](), { at: c.at, yaw: c.yaw, scale: c.scale });
        rests.set(c.look.slot, rest);
        setPose(c.look.slot, rest);
      }
      refreshCasters();
      return queue.length;
    }
    // Builds queued bodies for up to `budget` ms. Returns how many are still to build. Each body is
    // built at every level of detail (ballplayer-mesh.js createPlayerSet `lod`), the coarsest
    // first, so a man is on the field as soon as his far level is up.
    function pump(budget = 12) {
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < budget) {
        const [key, c] = queue.shift();
        const look = lookOf({ ...c.look, scale: c.scale, ...(c.kit ? { kit: c.kit } : {}) });
        const levels = [];
        for (let lod = PLAYER_LODS - 1; lod >= 0; lod--) {
          const G = createPlayerSet({ skin: true, lod });
          buildBody(G, { ...look });
          levels[lod] = [...G.batches].map(([k, b]) => ({ key: k, ...uploadSkin(b) }));
        }
        bodies.set(key, { batches: levels[0], levels });
      }
      refreshCasters();
      return queue.length;
    }
    // what casts the towers' shadows: each player with his body, in his row of the palette, at his
    // middle level (a shadow's edge is soft; the full level's 14,000 triangles four times over were
    // most of the shadow pass)
    function refreshCasters() {
      api.casters = members.filter((m) => bodies.has(m.key)).map((m) => { const b = bodies.get(m.key); return { slot: m.slot, batches: b.levels?.[1] || b.batches }; });
    }
    // Which level a man is drawn at this frame (quality.detail 2, or 1 for a level coarser
    // throughout): by how tall he stands on the screen, his pelvis and a point six feet over it
    // through the shot's matrix. Full detail from LOD_PX[0] pixels tall, the middle level from
    // LOD_PX[1].
    const LOD_PX = [110, 40];
    function lodOf(slot, VP, h, detail) {
      const J = joints.get(slot), p = J?.pelvis;
      if (!p) return 0;
      const y = (x, yy, z) => { const w = VP[3] * x + VP[7] * yy + VP[11] * z + VP[15]; return w > 1e-3 ? (VP[1] * x + VP[5] * yy + VP[9] * z + VP[13]) / w : null; };
      const a = y(p[0], p[1] - 3, p[2]), b = y(p[0], p[1] + 3, p[2]);
      if (a == null || b == null) return 0;
      const px = Math.abs(b - a) * h / 2;
      const lv = px >= LOD_PX[0] ? 0 : px >= LOD_PX[1] ? 1 : 2;
      return Math.min(PLAYER_LODS - 1, lv + (detail === 1 ? 1 : 0));
    }

    // ── the city round the park, and the park's name over its gate ─────────────
    // From the league's venue (venue.js): the content's site and art direction and the server's
    // skyline. The set is composed round this park's own outline (client/shared/city-set.js) and
    // built once (gl/cityscape.js), then each frame only draws it. A new venue replaces it.
    let city = null, cityVenue = null, streetCam = null;
    TEX.sign = null;
    function setVenue(v) {
      if (lost || !v || v === cityVenue) return city?.stats || null;
      cityVenue = v;
      relook();
      dropCity();
      if (v.site && v.skyline) {
        const art = v.city || null;
        // composed as diamond/streets.js has it, keeping tall things clear of the street camera
        const set = venueSet({ site: v.site, skyline: v.skyline, outline: park.outline, art });
        const c = buildCityscape(set, { art, outline: park.outline });
        city = {
          opaque: [...c.opaque].map(([key, b]) => ({ key, ...upload(b) })),
          glow: [...c.glow].map(([key, b]) => ({ key, ...upload(b) })),
          curtain: uploadCurtain(c.curtain, set.T),
          stats: { ...c.stats, placed: set.placed.length, unplaced: set.unplaced.length, bearing: set.bearing.median },
        };
        cityLights.set(c.lights);
        // the cars and the people on the streets round it, and the camera on the crossing outside
        // the main gate
        const life = streetLife(set, park.outline);
        streets.set(life);
        streetCam = streetShot(set);
        city.stats.streets = life.stats;
      }
      paintPlates(v.name);
      return city?.stats || null;
    }
    function dropCity() {
      if (!city) return;
      for (const d of [...city.opaque, ...city.glow]) { gl.deleteVertexArray(d.vao); gl.deleteBuffer(d.st.buf); }
      if (city.curtain) { gl.deleteVertexArray(city.curtain.vao); gl.deleteBuffer(city.curtain.st.buf); }
      cityLights.set(null);
      streets.set(null);
      streetCam = null;
      city = null;
    }
    // The Curtain's walls cut into panels a tile long, as the flight sim draws it a tile at a time,
    // so its rain streaks fall as densely.
    function uploadCurtain(walls, tile) {
      if (!walls.length) return null;
      const out = [];
      const put = (p, y, u, v) => out.push(p[0], y, p[2], u, v, NIGHT.curtain, 0);
      for (const { a, b, h } of walls) {
        const L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(1, Math.round(L / tile));
        for (let k = 0; k < n; k++) {
          const p = [a[0] + (b[0] - a[0]) * k / n, 0, a[2] + (b[2] - a[2]) * k / n], q = [a[0] + (b[0] - a[0]) * (k + 1) / n, 0, a[2] + (b[2] - a[2]) * (k + 1) / n];
          put(p, h, 0, 0); put(q, h, 1, 0); put(q, -0.35, 1, 1); put(p, h, 0, 0); put(q, -0.35, 1, 1); put(p, -0.35, 0, 1);
        }
      }
      const vao = gl.createVertexArray(), st = makeVertexStream(gl, vao, 7, [[0, 3, 0], [1, 2, 12], [2, 1, 20], [3, 1, 24]]);
      st.write(new Float32Array(out), out.length);
      return { vao, st, n: out.length / 7 };
    }
    // The name plates over the gates (paintPlateCanvas), in the deco hand once it has loaded.
    let plateAsk = 0;
    function paintPlates(name) {
      if (TEX.sign) { gl.deleteTexture(TEX.sign); TEX.sign = null; }
      TEX.sign = texture(paintPlateCanvas(doc, name), { repeat: false, af: 16 });
      const ask = ++plateAsk;
      loadDecoFace(doc).then((ok) => {
        if (!ok || lost || ask !== plateAsk || !TEX.sign) return;
        gl.deleteTexture(TEX.sign);
        TEX.sign = texture(paintPlateCanvas(doc, name), { repeat: false, af: 16 });
        opts.onAsset?.();
      });
    }
    const signDraw = { key: 'sign', ...upload(park.sign) };
    paintPlates(opts.venue?.name);

    // ── the ball ──────────────────────────────────────────────────────────────
    // Where the director's world has it (diamond/world.js), or nowhere. A sphere a little over its
    // real size, so a pitch reads on a 400-pixel screen, rewritten into one stream when it moves.
    // `back` is where it was a shutter's time before (the view's BALL_SHUTTER), so a ball going
    // fast is drawn drawn out along its way behind it, as a camera's shutter smears it.
    const BALL_DRAWN = BALL_R * 1.4;
    const ballBatch = createBatch(256), ballDraw = { key: 'ball', ...upload(createBatch(1)) };
    let ballAt = null;
    // The ball's spin: backspin about the way across its flight at BALL_SPIN turns a second of the
    // world's clock (so a slow replay turns it slowly), the axis held while it's still. Each vertex
    // carries, as its colour, where on the leather it is with the spin taken back out, and the
    // shader draws the seams there (LIT_FS, MAT.BALL); turning a few degrees a frame at 60 frames a
    // second, it reads as a turning ball rather than a flicker.
    const BALL_SPIN = 4;
    let spinAxis = [1, 0, 0];
    function ballSphere(b, centre, ax, r, ang) {
      const k = spinAxis, c = Math.cos(-ang), s = Math.sin(-ang);
      const unspin = (u) => {
        const d = k[0] * u[0] + k[1] * u[1] + k[2] * u[2], x = [k[1] * u[2] - k[2] * u[1], k[2] * u[0] - k[0] * u[2], k[0] * u[1] - k[1] * u[0]];
        return [0, 1, 2].map((i) => u[i] * c + x[i] * s + k[i] * d * (1 - c));
      };
      const rows = 10, cols = 16, P = (i, j) => { const th = i / (rows - 1) * Math.PI, ph = j / cols * Math.PI * 2; return [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)]; };
      const at = (u) => [0, 1, 2].map((i) => centre[i] + ax[0][i] * u[0] * r[0] + ax[1][i] * u[1] * r[1] + ax[2][i] * u[2] * r[2]);
      for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) {
        const q = [P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j)];
        // the ball's own frame is the park's; the axes only stretch it along its flight
        const wv = q.map((u) => [0, 1, 2].map((i) => ax[0][i] * u[0] + ax[1][i] * u[1] + ax[2][i] * u[2]));
        const v = q.map((u, n) => ({ p: at(u), n: wv[n], c: unspin(wv[n]) }));
        for (const t of [[0, 1, 2], [0, 2, 3]]) for (const n of t) vtx(b, v[n].p, v[n].n, [0, 0], v[n].c, MAT.BALL);
      }
    }
    function setBall(p, back = null) {
      ballAt = p && p.every(Number.isFinite) ? p.slice() : null;
      if (!ballAt) return;
      ballBatch.n = 0;
      const d = back && back.every(Number.isFinite) ? [ballAt[0] - back[0], ballAt[1] - back[1], ballAt[2] - back[2]] : null, L = d ? Math.hypot(d[0], d[1], d[2]) : 0;
      if (L > 1e-4) {
        // backspin: about the way across its flight, level with the ground
        const ax = [d[2], 0, -d[0]], al = Math.hypot(ax[0], ax[2]);
        if (al > 1e-4) spinAxis = [ax[0] / al, 0, ax[2] / al];
      }
      const ang = worldT * BALL_SPIN * Math.PI * 2;
      if (L > BALL_DRAWN * 0.5 && L < 12) {
        // an ellipsoid from where it was to where it is, its long axis along the way
        const f = d.map((v) => v / L), up = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        const a = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]], al = Math.hypot(a[0], a[1], a[2]);
        const s = a.map((v) => v / al), b = [f[1] * s[2] - f[2] * s[1], f[2] * s[0] - f[0] * s[2], f[0] * s[1] - f[1] * s[0]];
        const mid = [ballAt[0] - d[0] / 2, ballAt[1] - d[1] / 2, ballAt[2] - d[2] / 2];
        ballSphere(ballBatch, mid, [f, s, b], [BALL_DRAWN + L / 2, BALL_DRAWN, BALL_DRAWN], ang);
      } else ballSphere(ballBatch, ballAt, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [BALL_DRAWN, BALL_DRAWN, BALL_DRAWN], ang);
      ballDraw.st.write(ballBatch.data, ballBatch.n * STRIDE);
      ballDraw.n = ballBatch.n;
    }

    // ── the infield's marks ───────────────────────────────────────────────────
    // The dirt keeps the game (diamond/marks.js, painted by dirt.js paintMark): this park's own
    // copy of the infield canvas, made at the first mark, and only the rects the marks touch go up
    // to the GPU again. A new game starts on the canvas as painted (resetDirt).
    const dirtStats = { marks: 0, smoothed: 0, uploads: 0, texels: 0 };
    let dirtLive = null;
    function uploadDirt(rects) {
      if (!rects.length) return;
      gl.bindTexture(T2, TEX.dirt);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      const src = dirtLive || shared.dirt;
      for (const [x, y, w, h] of rects) {
        let sub = src;
        if (w !== src.width || h !== src.height) {
          sub = doc.createElement('canvas'); sub.width = w; sub.height = h;
          sub.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
        }
        gl.texSubImage2D(T2, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, sub);
        dirtStats.uploads++; dirtStats.texels += w * h;
      }
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(T2);
    }
    // Rects that overlap or nearly touch, merged, so a run of strides in one hole goes up once.
    function mergeRects(list) {
      const out = [];
      for (const r of list) {
        let a = r;
        for (let i = 0; i < out.length; i++) {
          const b = out[i], x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0] + a[2], b[0] + b[2]), y1 = Math.max(a[1] + a[3], b[1] + b[3]);
          if ((x1 - x0) * (y1 - y0) <= (a[2] * a[3] + b[2] * b[3]) * 1.5) { a = [x0, y0, x1 - x0, y1 - y0]; out.splice(i, 1); i = -1; }
        }
        out.push(a);
      }
      return out;
    }
    // What the game puts on the men's uniforms (LIT_FS uWear): by body (bodies' keys, so a runner
    // keeps his from bag to bag), how dirty low down (the knees, the shins, the seat) and up the
    // front. A slide or a dive (a mark's `scar`) dirties the man who made it, and every pitch's
    // stride the catcher's knees a little, crouched in the dirt behind the plate. A new game starts
    // clean (resetDirt).
    const wear = new Map(), WEAR = { scar: [0.35, 0.18], crouch: [0.006, 0] };
    function wearOn(slot, add) {
      const m = members.find((x) => x.slot === slot);
      if (!m) return;
      const w = wear.get(m.key) || [0, 0];
      wear.set(m.key, [Math.min(1, w[0] + add[0]), Math.min(1, w[1] + add[1])]);
    }
    function markDirt(list) {
      if (lost || !list?.length) return;
      for (const m of list) {
        if (m.kind === 'scar' && m.slot != null) wearOn(m.slot, WEAR.scar);
        else if (m.kind === 'stride') for (const [slot, role] of roles) if (role === 'catcher') wearOn(slot, WEAR.crouch);
      }
      if (!dirtLive) {
        dirtLive = doc.createElement('canvas');
        dirtLive.width = shared.dirt.width; dirtLive.height = shared.dirt.height;
        dirtLive.getContext('2d').drawImage(shared.dirt, 0, 0);
      }
      const g = dirtLive.getContext('2d'), rects = [];
      for (const m of list) { const r = paintMark(g, m, dirtLive.width); if (r) { rects.push(r); dirtStats.marks++; } }
      uploadDirt(mergeRects(rects));
    }
    function resetDirt() {
      wear.clear();
      if (lost || !dirtLive) return;
      dirtLive = null;
      uploadDirt([[0, 0, shared.dirt.width, shared.dirt.height]]);
    }
    // The grounds crew's drag (diamond/crew.js sweptAlong): the dirt inside each polygon ([x, z]
    // corners) as it was painted, and those rects up again. Nothing to do before the first mark.
    function smoothDirt(polys) {
      if (lost || !dirtLive || !polys?.length) return;
      const g = dirtLive.getContext('2d'), rects = [];
      for (const q of polys) { const r = smoothPoly(g, shared.dirt, q, dirtLive.width); if (r) rects.push(r); }
      dirtStats.smoothed += rects.length;
      uploadDirt(mergeRects(rects));
    }

    // ── the grounds crew's mats ──────────────────────────────────────────────
    // This frame's (diamond/crew.js matAt), each rope up over the right shoulder of the man pulling
    // it to his hands, where setPose last had him.
    const matBatch = createBatch(1024), matDraw = { key: 'mats', ...upload(createBatch(1)) };
    function setMats(list) {
      matBatch.n = 0;
      for (const m of list || []) {
        const men = (m.men || []).map((man) => {
          const J = joints.get(man.slot);
          if (!J) return { side: man.side, hands: m.ropes[man.side > 0 ? 0 : 1] };
          return { side: man.side, shoulder: [J.shR[0], J.shR[1] + 0.24, J.shR[2]], hands: J.handL.map((v, i) => (v + J.handR[i]) / 2) };
        });
        dragMat(matBatch, m, men);
      }
      matDraw.st.write(matBatch.data, matBatch.n * STRIDE);
      matDraw.n = matBatch.n;
    }

    // ── the lights and the roof ───────────────────────────────────────────────
    // Each light burns in proportion to its working lamps, a deck's row a little less than a tower.
    // Where each one is depends on the roof (ballpark-mesh.js roofLights): open, the four towers and
    // the decks' rows; shut, the towers' light has gone over to the lamps under the decks.
    const LPos = new Float32Array(18), LCol = new Float32Array(18), LDir = new Float32Array(18);
    const lightsOf = park.field.towers.slice(0, 6);
    const lightK = lightsOf.map((T) => NIGHT.towers * (T.frac / 0.62) * (T.kind === 'deck' ? 0.85 : 1));
    // The floods as floods (LIGHTS_GLSL floodAtt, quality.light): each light's distance to where its
    // axis meets the ground, which its falloff is reckoned from; a tower's bank of lamps is
    // FLOOD.bank feet across, and a row under a deck (a deck's own, or a tower's gone under it with
    // the roof shut) FLOOD.row feet long, square to where it points.
    const LRef = new Float32Array(6), LRad = new Float32Array(6), LLen = new Float32Array(6), LAx = new Float32Array(18), LGeo = new Float32Array(18);
    const FLOOD = { bank: 32, row: 150 };
    function placeLights(p) {
      roofLights(lightsOf, p).forEach((L, i) => {
        const k = lightK[i] * L.k;
        LPos.set(L.lamp, i * 3); LCol.set([k, k * 0.965, k * 0.9], i * 3); LDir.set(L.dir, i * 3);
        LRef[i] = L.dir[1] < -0.05 ? Math.min(900, L.lamp[1] / -L.dir[1]) : 400;
        const row = lightsOf[i].kind === 'deck' || L.lamp !== lightsOf[i].lamp, hl = Math.hypot(L.dir[0], L.dir[2]) || 1;
        LRad[i] = row ? 4 : FLOOD.bank / 2; LLen[i] = row ? FLOOD.row / 2 : 0;
        LAx.set([-L.dir[2] / hl, 0, L.dir[0] / hl], i * 3);
        LGeo.set([LRef[i], LRad[i], LLen[i]], i * 3);
      });
      bounceFrom();
    }
    // What the field throws back up (uBounce): the towers' light on the grass at a few points across
    // it, as the shader reckons it, times the field's colour and BOUNCE of the way.
    const FIELD_ALB = [0.09, 0.12, 0.05], BOUNCE = 0.6, ZERO3 = new Float32Array(3), bounce = new Float32Array(3);
    const FIELD_PTS = [[0, 0, 60], [0, 0, 220], [-120, 0, 160], [120, 0, 160], [0, 0, 330]];
    function bounceFrom() {
      const E = [0, 0, 0];
      for (const p of FIELD_PTS) for (let i = 0; i < 6; i++) {
        let v = [LPos[i * 3] - p[0], LPos[i * 3 + 1] - p[1], LPos[i * 3 + 2] - p[2]];
        if (LLen[i] > 0) { const ax = [LAx[i * 3], 0, LAx[i * 3 + 2]], s = Math.max(-LLen[i], Math.min(LLen[i], -(v[0] * ax[0] + v[2] * ax[2]))); v = [v[0] + ax[0] * s, v[1], v[2] + ax[2] * s]; }
        const d = Math.hypot(v[0], v[1], v[2]), L = v.map((x) => x / d), nl = Math.max(0, L[1]);
        const c = -(L[0] * LDir[i * 3] + L[1] * LDir[i * 3 + 1] + L[2] * LDir[i * 3 + 2]), t = Math.min(1, Math.max(0, (c - 0.45) / 0.4));
        const spot = 0.05 + 0.95 * t * t * (3 - 2 * t), att = Math.min(2, (LRef[i] / d) ** 2) * Math.exp(-Math.max(d - 900, 0) / 300);
        for (let k = 0; k < 3; k++) E[k] += LCol[i * 3 + k] * nl * spot * att;
      }
      for (let k = 0; k < 3; k++) bounce[k] = FIELD_ALB[k] * (E[k] / FIELD_PTS.length) / Math.PI * BOUNCE;
    }
    // The roof's travel (roofTrack): a payload's `roof` says where it is going, and a change takes the
    // map's five minutes (world-feed.js ROOF_MS). Shut until a payload says otherwise, as the map's
    // static picture is.
    const roofT = roofTrack(ROOF_MS);
    const clock = () => (opts.now ? opts.now() : typeof performance !== 'undefined' ? performance.now() : Date.now());
    function setRoof(shut) {
      const now = clock();
      if (shut != null) roofT.set(!!+shut, now);
      return roofT.at(now);
    }
    let roofNow = roofT.at(clock());
    placeLights(roofNow);
    const fence = park.field.fence;
    // the towers cast, as many as there are maps, wherever their light is; the decks' rows don't
    const LSh = new Int32Array(6).fill(-1);
    { let k = 0; lightsOf.forEach((T, i) => { if (T.kind !== 'deck' && k < shadows.count) LSh[i] = k++; }); }
    const casting = lightsOf.map((T, i) => i).filter((i) => LSh[i] >= 0);
    // with the structure casting, each map's depth starts this share of the way from its lamp to the
    // play (spotshadow.js spotMatrix `near`): past the lamp's own housing and mast, short of the stands
    const SHADOW_NEAR = 0.15;
    // the low sun's map is fitted to the whole bowl, so its shadow has no edge in any shot; this
    // frame's sun (or null), its map's index, and each tower's map this frame (the last tower's
    // goes to the sun when every one is in use)
    const SUN_FIT = [[0, 0, 160], 640];
    let sunNow = null, sunSh = -1, spotsNow = 0;
    // The exposure the frame is taken at. Under the floods as floods (quality.light) the white
    // jerseys and the faces near the lamps clipped at the park's first exposure, so it's taken
    // LIGHT_EXPOSURE of the way; the first lighting keeps its own.
    const LIGHT_EXPOSURE = 0.85;
    const exposureOf = (q) => q.exposure * (q.light !== 0 && q.light !== false ? LIGHT_EXPOSURE : 1);
    // the phone tier's contact patches under the men and the ball (LIT_FS blobAt)
    const blobs = new Float32Array(16 * 4);
    let blobN = 0;
    const LShF = new Int32Array(6);
    const lampOf = (i) => [LPos[i * 3], LPos[i * 3 + 1], LPos[i * 3 + 2]];

    // The depth the frame was drawn with, resolved into a texture the lens and the occlusion read.
    // A blit from the multisampled target costs no second pass over the park.
    let depth = null;
    function depthTarget(w, h) {
      if (depth && depth.w === w && depth.h === h) return depth;
      if (depth) { gl.deleteFramebuffer(depth.fbo); gl.deleteTexture(depth.tex); depth = null; }
      const tex = gl.createTexture();
      gl.bindTexture(T2, tex);
      gl.texStorage2D(T2, 1, gl.DEPTH_COMPONENT24, w, h);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(T2, k, v);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, T2, tex, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); return null; }
      return (depth = { tex, fbo, w, h });
    }

    // The park's light at the hour the payload aired (setHour, diamond/sky.js), against the venue's
    // bearing and its city's glow; night until a payload says otherwise.
    let hourNow = null, wxNow = null, look = skyLook(null), worldT = 0;
    const relook = () => { look = skyLook(hourNow, { bearing: cityVenue?.site?.bearing, glow: cityVenue?.city?.glow, wx: wxNow }); };
    // The weather over the park (a payload's `wx`, diamond/weather.js): the look, what falls and the
    // lightning; and the world's time, which what falls and the bolts are drawn at.
    function setWeather(wx, o = {}) {
      wxNow = wx && typeof wx === 'object' ? wx : null;
      weather.set(wxNow, o);
      relook();
      return look;
    }
    function setHour(h) {
      const next = Number.isFinite(h) ? ((h % 24) + 24) % 24 : null;
      if (next === hourNow) return look;
      hourNow = next;
      relook();
      return look;
    }

    // this frame's ambient from above and sky, with any bolt's flash in them
    let frameUp = look.up, frameZen = look.zen, frameHor = look.hor, frameAway = look.horAway;
    // the light on the streets: the sky's, and the sodium lamps' once they're on (gl/streetlife.js)
    const SODIUM_FILL = [1.0, 0.46, 0.13];
    const streetLook = (q) => ({
      up: frameUp, dn: look.dn, fill: SODIUM_FILL.map((v) => v * look.pool * 2.4), lamps: look.lights,
      fogDens: q.fog ? look.fogDens : 0, fogH: NIGHT.fogH, fogCol: look.fog,
    });
    // the birds (gl/parkbirds.js): the gulls lit from below by the share of the towers' light the
    // field throws back up, and the starlings out toward the sunset in the evening; both down out
    // of the rain, the snow and the lightning, and nowhere under a shut roof
    const BIRD_FLOOD = 0.12;
    const birdFlood = [0, 1, 2].map((c) => { let s = 0; for (let i = 0; i < 6; i++) s += LCol[i * 3 + c]; return (s / 6) * BIRD_FLOOD; });
    const birdLook = (q) => {
      const aloft = q.birds !== false && !weather.look.fall && !weather.look.bolts && roofNow < 0.5;
      return {
        up: frameUp, dn: look.dn, flood: birdFlood, night: look.night, sun: look.sun, evening: hourNow == null || hourNow >= 12,
        fogDens: q.fog ? look.fogDens : 0, fogH: NIGHT.fogH, fogCol: look.fog, gulls: aloft, starlings: aloft,
      };
    };

    let lost = false;
    canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); lost = true; api.lost = true; });
    const stats = { tris: 0, draws: 0, ms: 0 };

    function lights(P, eye) {
      gl.uniform3fv(P.u('uLPos'), LPos); gl.uniform3fv(P.u('uLCol'), LCol); gl.uniform3fv(P.u('uLDir'), LDir);
      gl.uniform3fv(P.u('uEye'), eye); gl.uniform3fv(P.u('uSkyUp'), frameUp); gl.uniform3fv(P.u('uSkyDn'), look.dn);
      const q = api.quality;
      gl.uniform3fv(P.u('uFogCol'), look.fog); gl.uniform1f(P.u('uFogDens'), q.fog ? look.fogDens : 0); gl.uniform1f(P.u('uFogH'), NIGHT.fogH);
      gl.uniform1f(P.u('uShaft'), q.fog ? NIGHT.shaft : 0); gl.uniform1f(P.u('uShaftReach'), NIGHT.shaftReach);
      const flood = q.light !== 0 && q.light !== false;
      gl.uniform1f(P.u('uFlood'), flood ? 1 : 0);
      gl.uniform3fv(P.u('uLGeo'), LGeo); gl.uniform3fv(P.u('uLAx'), LAx);
      gl.uniform3fv(P.u('uBounce'), flood ? bounce : ZERO3);
      gl.uniform3fv(P.u('uSunDir'), sunNow ? sunNow.dir : [0, 1, 0]); gl.uniform3fv(P.u('uSunCol'), sunNow ? sunNow.col : ZERO3);
      gl.uniform1i(P.u('uSunSh'), sunNow && sunSh >= 0 && sunSh < spotsNow ? sunSh : -1);
      gl.uniform1f(P.u('uWet'), look.wet || 0);
    }

    // ── a frame ───────────────────────────────────────────────────────────────
    function render(shot) {
      if (lost) return false;
      const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
      const w = canvas.width, h = canvas.height;
      if (!(w > 0 && h > 0)) return false;
      // the street camera stands on this venue's own crossing
      if (shot === 'street' && streetCam) shot = { ...streetCam, shadow: [[streetCam.at[0], 0, streetCam.at[2] - 30], 140] };
      const M = shotMatrices(shot, w / h), q = api.quality;
      let tris = 0, draws = 0;
      // where the roof has got to, and the lights with it; under it, nothing falls on the camera
      roofNow = roofT.at(clock());
      placeLights(roofNow);
      const underRoof = roofNow > 0.5 && insideOutline(park.outline, M.eye);
      for (const d of lampDraws) d.emis = d.kind === 'tower' ? Math.max(0, 1 - 2 * roofNow) : d.kind === 'deck' ? 1 : look.lights;
      const flash = weather.flashAt(), add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
      frameUp = flash ? add3(look.up, flash.up) : look.up;
      frameZen = flash ? add3(look.zen, flash.sky) : look.zen; frameHor = flash ? add3(look.hor, flash.sky) : look.hor; frameAway = flash ? add3(look.horAway, flash.sky) : look.horAway;

      // the players' poses, sent once for the shadows and the picture both
      palette.upload();

      // 1. the towers' shadows, of whatever casts: the players, skinned; and where the tier has them
      // (quality.stands), the park's own structure and its roof's shells where they've rolled to, and
      // the ball, so a grandstand's shadow lies across the field and a fly ball's on the grass
      let spotN = 0;
      spotsNow = 0;
      const casters = api.casters, stands = q.stands !== false && q.stands !== 0;
      // as many of the casting towers as the tier has shadows for, the two by the infield first
      const nCast = q.shadows === true ? casting.length : Math.max(0, Math.min(casting.length, q.shadows | 0));
      // the low sun before it sets (diamond/sky.js sunLight): its own map over the whole park, the
      // bowl and its roof always in it, taking the last tower's map if every one is in use
      sunNow = q.sun !== false && roofNow < 0.999 ? look.sunLight : null;
      sunSh = -1;
      LShF.set(LSh);
      const list = (nCast && (casters.length || stands) ? casting.slice(0, nCast) : []).map((i) => {
        const [focus, radius] = M.shadow || [[0, 0, 60], 80];
        return { lamp: lampOf(i), focus, radius, near: stands ? SHADOW_NEAR : null };
      });
      if (sunNow) {
        if (list.length >= shadows.count) list.pop();
        sunSh = list.length;
        const d = sunNow.dir;
        list.push({ lamp: [SUN_FIT[0][0] + d[0] * 6000, SUN_FIT[0][1] + d[1] * 6000, SUN_FIT[0][2] + d[2] * 6000], focus: SUN_FIT[0], radius: SUN_FIT[1], near: 0.5, sun: true });
        for (let i = 0; i < 6; i++) if (LShF[i] >= sunSh) LShF[i] = -1;
      }
      if (list.length) {
        spotN = shadows.render(list, (vp, own, k) => {
          const struct = stands || k === sunSh;
          gl.useProgram(SKD.p);
          gl.uniformMatrix4fv(SKD.u('uVP'), false, vp);
          palette.bind(9); gl.uniform1i(SKD.u('uBones'), 9);
          for (const c of casters) {
            gl.uniform1i(SKD.u('uBoneRow'), c.slot);
            for (const b of c.batches) { gl.bindVertexArray(b.vao); gl.drawArrays(gl.TRIANGLES, 0, b.n); }
          }
          if (struct) {
            gl.useProgram(STD.p);
            gl.uniformMatrix4fv(STD.u('uVP'), false, vp);
            gl.uniform3f(STD.u('uShift'), 0, 0, 0);
            for (const d of opaque) { gl.bindVertexArray(d.vao); gl.drawArrays(gl.TRIANGLES, 0, d.n); }
            if (ballAt) { gl.bindVertexArray(ballDraw.vao); gl.drawArrays(gl.TRIANGLES, 0, ballDraw.n); }
            for (const d of shells) {
              const s = shellShift(d.i, roofNow);
              gl.uniform3f(STD.u('uShift'), s[0], s[1], s[2]);
              gl.bindVertexArray(d.vao); gl.drawArrays(gl.TRIANGLES, 0, d.n);
            }
          }
          gl.bindVertexArray(null);
          gl.useProgram(own);
        });
      }

      spotsNow = spotN;
      // no tower casting (the phone tier): each man and the ball get a soft patch on the ground
      blobN = 0;
      if (!spotN && q.light !== 0 && q.light !== false) {
        for (const m of members) {
          const J = joints.get(m.slot);
          if (!J || !J.pelvis || blobN >= 15) continue;
          blobs.set([J.pelvis[0], J.pelvis[2], 1.7, 0.55 * Math.max(0, 1 - J.pelvis[1] / 9)], blobN++ * 4);
        }
        if (ballAt && ballAt[1] < 60) blobs.set([ballAt[0], ballAt[2], 0.45 + ballAt[1] / 40, 0.5 * (1 - ballAt[1] / 60)], blobN++ * 4);
      }
      if (!hdr.bind(w, h, q.msaa === false ? 0 : 4)) return false;
      gl.clearColor(0, 0, 0, 1); gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);

      // the sky, behind everything
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(SKY.p);
      lights(SKY, M.eye);
      gl.uniformMatrix4fv(SKY.u('uInvVP'), false, inv4(M.viewProj));
      gl.uniform3fv(SKY.u('uZen'), frameZen); gl.uniform3fv(SKY.u('uHor'), frameHor); gl.uniform3fv(SKY.u('uHorAway'), frameAway);
      gl.uniform3fv(SKY.u('uSunDir'), look.sun); gl.uniform3fv(SKY.u('uGlow'), look.glow); gl.uniform1f(SKY.u('uStars'), look.stars);
      gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); draws++;

      // the park, and then the players: the same lit shader, the players' skinned
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(T2, TEX.dirt);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(T2, TEX.grass);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(T2, boardTex);
      gl.activeTexture(gl.TEXTURE8); gl.bindTexture(T2, TEX.faces);
      palette.bind(9);
      const litSetup = (P) => {
        gl.useProgram(P.p);
        lights(P, M.eye);
        gl.uniformMatrix4fv(P.u('uVP'), false, M.viewProj);
        gl.uniform1i(P.u('uTex'), 0); gl.uniform1i(P.u('uDirt'), 1); gl.uniform1i(P.u('uGrass'), 2); gl.uniform1i(P.u('uBoard'), 3);
        gl.uniform3f(P.u('uFence'), fence.line, fence.centre, fence.curve);
        gl.uniform2f(P.u('uBoardRes'), BOARD_W, BOARD_H); gl.uniform3f(P.u('uBoardOn'), 6.0, 3.0, 0.7);
        gl.uniform1f(P.u('uCityLit'), look.cityLit); gl.uniform1f(P.u('uPoolK'), look.pool);
        gl.uniform1f(P.u('uRoof'), roofNow); gl.uniform1f(P.u('uDome'), roofNow); gl.uniform3f(P.u('uShift'), 0, 0, 0);
        shadows.bind(P.u, 4, q.light !== 0 && q.light !== false ? 1 : 0);
        gl.uniform1iv(P.u('uLSh'), LShF); gl.uniform1i(P.u('uSpotN'), spotN);
        gl.uniform4fv(P.u('uBlob'), blobs); gl.uniform1i(P.u('uBlobN'), blobN);
        gl.uniform1i(P.u('uHeadSlot'), 0); gl.uniform4f(P.u('uKitCell'), 0, 0, 0, 0);
      };
      const drawSet = (list, alpha, P = LIT) => {
        for (const d of list) {
          const t = TEX[d.key];
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(T2, t || null);
          gl.uniform1i(P.u('uTextured'), t ? 1 : 0);
          gl.uniform1f(P.u('uAlphaTest'), ALPHA_TEST.has(d.key) ? 0.5 : -1);
          gl.uniform1f(P.u('uAlpha'), alpha);
          gl.uniform1f(P.u('uEmis'), d.key === 'sign' ? NIGHT.sign : d.emis ?? 1);
          gl.bindVertexArray(d.vao); gl.drawArrays(gl.TRIANGLES, 0, d.n);
          tris += d.n / 3; draws++;
        }
      };
      litSetup(LIT);
      drawSet(opaque, 1);
      drawSet(lampDraws, 1);
      // the roof's shells, each where the roof has got to on its rails
      for (const d of shells) {
        const s = shellShift(d.i, roofNow);
        gl.uniform3f(LIT.u('uShift'), s[0], s[1], s[2]);
        drawSet([d], 1);
      }
      gl.uniform3f(LIT.u('uShift'), 0, 0, 0);
      if (final && dress) drawSet(dress.opaque, 1);
      if (final && champ && dress) drawSet([dress.trophy], 1);
      if (TEX.sign) drawSet([signDraw], 1);
      if (ballAt) drawSet([ballDraw], 1);
      if (matDraw.n) drawSet([matDraw], 1);
      if (city) {
        drawSet(city.opaque, 1);
        // the cars and the people on the streets, lit by the sky and, once they're on, the lamps
        const sl = streets.draw(M, h, worldT, streetLook(q));
        tris += sl.tris; draws += sl.draws;
      }
      // the gulls wheeling over the outfield
      { const gb = birds.drawGulls(M, h, worldT, birdLook(q)); tris += gb.tris; draws += gb.draws; }
      // the players: each one's bones from his row of the palette (unit 9), his face from the atlas
      // (unit 8) and the head arrays, his jersey from his slot's cell
      litSetup(SKLIT);
      gl.uniform1i(SKLIT.u('uFaceAtlas'), 8); gl.uniform1i(SKLIT.u('uBones'), 9); gl.uniform1f(SKLIT.u('uBlinkT'), worldT);
      gl.uniform1f(SKLIT.u('uTwill'), q.light !== 0 && q.light !== false ? 1 : 0);
      gl.uniform4fv(SKLIT.u('uHeadA'), HA); gl.uniform4fv(SKLIT.u('uHeadB'), HB); gl.uniform4fv(SKLIT.u('uHeadC'), HC); gl.uniform4fv(SKLIT.u('uHeadD'), HD);
      const detail = q.detail ?? 2;
      for (const m of members) {
        const body = bodies.get(m.key);
        if (!body) continue;
        const cell = kitCell(m.slot);
        gl.uniform1i(SKLIT.u('uBoneRow'), m.slot); gl.uniform1i(SKLIT.u('uHeadSlot'), m.slot);
        gl.uniform4f(SKLIT.u('uKitCell'), cell[0], cell[1], cell[2], cell[3]);
        const wr = wear.get(m.key);
        gl.uniform2f(SKLIT.u('uWear'), wr ? wr[0] : 0, wr ? wr[1] : 0);
        drawSet(body.levels?.[lodOf(m.slot, M.viewProj, h, detail)] || body.batches, 1, SKLIT);
      }

      // the crowd
      if (crowd.length) {
        gl.useProgram(CROWD.p);
        lights(CROWD, M.eye);
        shadows.bind(CROWD.u, 4, q.light !== 0 && q.light !== false ? 1 : 0);
        gl.uniformMatrix4fv(CROWD.u('uVP'), false, M.viewProj);
        gl.uniform2f(CROWD.u('uRoar'), roar.home, roar.away); gl.uniform1f(CROWD.u('uT'), roar.t); gl.uniform1f(CROWD.u('uMove'), roar.move);
        lookAtPlay(roar.t);
        gl.uniform3f(CROWD.u('uLook'), crowdLook.x, crowdLook.z, crowdLook.w);
        const share = crowdShare(), close = (q.fans ?? 1) >= 2 && M.fov > 0 && M.fov <= CLOSE_FOV;
        const cards = q.cards !== false && q.cards !== 0;
        if (cards) splitCrowd(crowd, M, h, share); else unsplitCrowd(crowd);
        for (const d of crowd) {
          const k = cards && d.figs != null ? d.figs : Math.round(d.count * share);
          if (!k) continue;
          const n = close ? d.nNear : d.n;
          gl.uniform1f(CROWD.u('uBase'), d.base); gl.bindVertexArray(close ? d.near : d.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, n, k); tris += n / 3 * k; draws++;
        }
        // and the far ones as cards, two triangles each
        if (cards && crowd.some((d) => d.cards)) {
          gl.useProgram(CARD.p);
          lights(CARD, M.eye);
          gl.uniformMatrix4fv(CARD.u('uVP'), false, M.viewProj);
          gl.uniform2f(CARD.u('uRoar'), roar.home, roar.away); gl.uniform1f(CARD.u('uT'), roar.t); gl.uniform1f(CARD.u('uMove'), roar.move);
          gl.uniform3fv(CARD.u('uEyeC'), M.eye);
          for (const d of crowd) {
            if (!d.cards) continue;
            gl.uniform1f(CARD.u('uBase'), d.base); gl.bindVertexArray(d.cardVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, d.cards); tris += 2 * d.cards; draws++;
          }
          gl.useProgram(CROWD.p);
        }
      }

      // the backstop net, see-through, over the rest
      gl.useProgram(LIT.p);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      drawSet(translucent, 0.32);
      // light added over the frame: the lamps' pools on the streets, the Curtain, then the spectacle
      gl.blendFunc(gl.ONE, gl.ONE);
      if (city) {
        drawSet(city.glow, 1);
        if (city.curtain) {
          gl.useProgram(CURT.p); applyLinOut(gl, CURT.p, 1);
          gl.uniformMatrix4fv(CURT.u('uVP'), false, M.viewProj);
          gl.uniform1f(CURT.u('uTime'), 0);
          gl.bindVertexArray(city.curtain.vao); gl.drawArrays(gl.TRIANGLES, 0, city.curtain.n);
          tris += city.curtain.n / 3; draws++;
        }
      }
      {
        // the buildings' own lights: all of them on the top tier, no smoke below it, and no
        // searchlights at the bottom; a plume lit from below by the city once its lights are on,
        // and by the sky; and the crowd's camera flashes, with a city round the park or without
        const tier = q.city ?? 2;
        const cl = cityLights.draw(M, h, worldT, {
          on: look.lights, fogDens: q.fog ? look.fogDens : 0, fogH: NIGHT.fogH,
          lit: look.up.map((v, i) => v * 3 + look.glow[i] * 4 + PLUME.lit * look.lights), beams: tier >= 1, steam: tier >= 2,
          extra: flashBuf, extraN: flashPoints(),
        });
        tris += cl.tris; draws += cl.draws;
        // the lamps of the cars going by
        const sl = streets.drawLamps(M, h, worldT, streetLook(q));
        tris += sl.tris; draws += sl.draws;
        // the starlings over the city at dusk, dark against the sky
        const sb = birds.drawStarlings(M, h, worldT, birdLook(q));
        tris += sb.tris; draws += sb.draws;
        gl.blendFunc(gl.ONE, gl.ONE);
      }
      const fx = spectacle.draw(M, h, { fx: q.fx });
      tris += fx.tris; draws += fx.draws;
      // what falls and the bolts (each sets its own blend); nothing falls under a shut roof
      const wd = weather.draw(M, w, h, { fall: !underRoof });
      tris += wd.tris; draws += wd.draws;
      gl.depthMask(true); gl.disable(gl.BLEND);
      gl.bindVertexArray(null);

      // 3. the depth, out of the multisampled target before it's resolved
      const D = (q.ao || q.dof > 0) ? depthTarget(w, h) : null;
      if (D) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr.drawFbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, D.fbo);
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      }

      // resolve, and gather the bloom off the lamps
      const res = hdr.resolve({ bloom: 1, threshold: 1.0, knee: 0.5, linear: 0 });
      if (!res) return false;

      // 4. the occlusion, at half size
      const aoDiv = q.ao === true ? 2 : Math.max(1, +q.ao || 2);
      const ao = D && q.ao && ssao ? ssao.render(D.tex, Math.max(1, Math.round(w / aoDiv)), Math.max(1, Math.round(h / aoDiv)), ssaoConstants(M.proj), { radius: 2.0, bias: 0.05, slope: 3 }) : null;

      // 5. the lens, the curve and the grade onto the canvas
      if (bc && bc.render({
        scene: res.scene, bloom: res.bloom, depth: D ? D.tex : null, ao, w, h, near: M.near, far: M.far,
        focus: Math.hypot(M.at[0] - M.eye[0], M.at[1] - M.eye[1], M.at[2] - M.eye[2]), dof: M.dof || 0, taps: q.dof,
        exposure: exposureOf(q), bloomK: q.bloom, aoK: q.aoK ?? 0.75, grade: q.grade, tube: q.tube, seed: 3.7, look: q.light !== 0 && q.light !== false,
      })) {
        stats.tris = Math.round(tris); stats.draws = draws + 2;
        stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
        return true;
      }
      // no broadcast pass: the plain curve
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(FINAL.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(T2, res.scene); gl.uniform1i(FINAL.u('uScene'), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(T2, res.bloom ? res.bloom[0] : res.scene); gl.uniform1i(FINAL.u('uB0'), 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(T2, res.bloom ? res.bloom[1] : res.scene); gl.uniform1i(FINAL.u('uB1'), 2);
      gl.uniform1f(FINAL.u('uBloom'), res.bloom ? api.quality.bloom : 0);
      gl.uniform1f(FINAL.u('uExp'), exposureOf(api.quality));
      gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); draws++;
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.DEPTH_TEST);
      stats.tris = Math.round(tris); stats.draws = draws;
      stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      return true;
    }

    function dispose() {
      try {
        shadows.dispose(); ssao?.dispose(); bc?.dispose(); spectacle.dispose(); weather.dispose(); cityLights.dispose(); streets.dispose(); birds.dispose();
        if (depth) { gl.deleteFramebuffer(depth.fbo); gl.deleteTexture(depth.tex); depth = null; }
        for (const t of Object.values(TEX)) gl.deleteTexture(t);
        gl.deleteTexture(boardTex);
        for (const d of [...opaque, ...translucent, ...lampDraws, ...shells, signDraw, ballDraw, matDraw]) { gl.deleteVertexArray(d.vao); gl.deleteBuffer(d.st.buf); }
        dropCity();
        dropCrowd(homeCrowd); if (fullCrowd) dropCrowd(fullCrowd);
        if (dress) for (const d of [...dress.opaque, dress.trophy]) { gl.deleteVertexArray(d.vao); gl.deleteBuffer(d.st.buf); }
        for (const body of bodies.values()) dropBody(body);
        bodies.clear();
        palette.dispose();
        hdr.dispose();
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch { /* a lost context has nothing left to free */ }
      lost = true; api.lost = true;
    }

    // A final (setFinal({ name }) or null): the park dressed for it (ballpark-mesh.js buildDress), its
    // logo painted with the final's name, a full house waving towels; setChampion(true) puts the
    // trophy out once the last out's made. The dress is built the first time a final asks for it.
    let final = null, champ = false, dress = null;
    function setFinal(f) {
      const on = !!(f && f.name);
      if (!on) { final = null; champ = false; crowd = homeCrowd; return; }
      if (!dress) {
        const d = buildDress(opts.venue);
        dress = { opaque: [...d.opaque].map(([key, b]) => ({ key, ...upload(b) })), trophy: { key: 'trophy', ...upload(d.trophy) } };
      }
      if (!final || final.name !== f.name) {
        if (TEX.finalLogo) gl.deleteTexture(TEX.finalLogo);
        TEX.finalLogo = texture(finalLogoCanvas(doc, f.name), { repeat: false, premul: true });
        loadHudFaces(doc).then(() => {
          if (lost || !final || final.name !== f.name) return;
          gl.deleteTexture(TEX.finalLogo); TEX.finalLogo = texture(finalLogoCanvas(doc, f.name), { repeat: false, premul: true });
          opts.onAsset?.();
        });
      }
      if (!fullCrowd) fullCrowd = crowdOf(buildPark(opts.venue, { full: true }).crowd, true);
      crowd = fullCrowd;
      final = { name: f.name };
    }

    const api = {
      kind: 'gl', lost: false,
      // grade: 'arcade', 'broadcast' or 'none'; tube: the tube glass; and the full tier's keys
      // (diamond/quality.js): dpr, msaa, shadows (how many towers cast), ao (the occlusion's size
      // against the frame's), dof (the lens's taps), crowd (the share of the fans drawn), city (the
      // city's own lights), fx (the spectacle), birds and flashes. The view's governor sets them.
      quality: { bloom: 0.18, exposure: 1.0, grade: opts.grade || 'arcade', tube: !!opts.tube, fog: true, ...PARK_TIERS.full },
      // what casts the towers' shadows: the players, [{ slot, batches }], skinned from the palette
      casters: [],
      // setPose(slot, pose): a player into a pose from the rig's pose language, with at, yaw, scale;
      // setBall(point or null): the ball, in the park's feet; setSpectacle(effects, t): the
      // payload's spectacle (diamond/spectacle.js) and the world's time to draw it at;
      // markDirt(marks): the game's marks into the infield (diamond/marks.js), resetDirt() a fresh one;
      // setHour(h): the park's light at an in-game hour (diamond/sky.js), null for the night;
      // setWeather(wx, { flash }): the weather over the park (diamond/weather.js), with no lightning
      // flash for less motion; setTime(t): the world's time, which what falls, the bolts and the
      // city's moving lights are drawn at
      // setRoof(shut): where the venue's roof is going (a payload's `roof`, 1 shut, 0 open; null
      // keeps it), the first one heard taken as where it is; `roof` is { p, to, moving } now, and the
      // view keeps drawing while it moves
      setRoof, get roof() { const now = clock(); return { p: roofT.at(now), to: roofT.to, moving: roofT.moving(now) }; },
      render, setBoard, setCast, setPose, idle, setBall, setSpectacle: (fx, t) => spectacle.set(fx, t), pump, setVenue, dispose, stats,
      markDirt, resetDirt, smoothDirt, setMats, dirtStats, setHour, setWeather, get look() { return look; },
      setTime: (t) => { worldT = Number.isFinite(t) ? t : 0; weather.setTime(worldT); },
      get cityLights() { return cityLights.counts; },
      get streets() { return streets.counts; },
      setFinal, setChampion: (on) => { champ = !!on; }, get final() { return final ? { ...final, champion: champ } : null; },
      setCrowd: (levels, t, move = true) => { roar.home = +levels?.[0] || 0; roar.away = +levels?.[1] || 0; roar.t = +t || 0; roar.move = move ? 1 : 0; },
      pending: () => queue.length,
      get park() { return park; },
      // what the city came to: { buildings, filler, lamps, tris, placed, bearing, … }, or null
      get city() { return city?.stats || null; },
      get players() { return bodies.size; },
    };
    return api;
  }
}
