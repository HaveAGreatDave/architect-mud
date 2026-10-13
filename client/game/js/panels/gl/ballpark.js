// GLASS 2 · THE BALLPARK. Deadball's park drawn by WebGL2 (the Grandstand, gameday-grandstand.js).
//
// The park is lit the way a night game is: six light towers are the only lights, each a bank
// of lamps the venue says are working or not, and every surface is lit by them in linear light
// with a GGX highlight. The frame goes into hdr.js's multisampled float target, so a lamp can be
// twenty times brighter than white and bloom off it, and this file's own last pass takes the
// filmic curve in linear light and encodes for the screen.
//
//   · the park is built once from the venue by ballpark-mesh.js (pure, so the gate checks it);
//   · the field is painted in the shader: grass with mowing stripes that change with the
//     camera's direction, the warning track, the foul lines, and the infield canvas
//     (diamond/dirt.js) laid over it;
//   · the crowd is one figure per pose, instanced over every occupied seat;
//   · the scoreboard is a face of lamps lit from a 240×84 mask of the line score
//     (diamond/board.js), redrawn when the game changes;
//   · the players are skinned: a body per player, built once in the rig's bind pose
//     (gl/ballplayer-mesh.js buildBody, diamond/rig.js) a few a frame so a new cast never stalls
//     the page, and moved by its bones on the GPU (gl/skin.js) into the pose the cast gives it
//     (diamond/cast.js) or `setPose` does; the street figure's heads are shaded with their faces
//     from the atlas as the Actor Lab shades them;
//   · outside, the park's brick wall is painted in the shader (EXTERIOR), and its name is lit
//     over the main gate once the venue says it;
//   · the city round it is a set composed from the league's venue (client/shared/city-set.js)
//     and built once (gl/cityscape.js): facades and streets painted from their coordinates,
//     sodium lamps with their pools added over the ground, and the Curtain on the set's walls
//     in gl/curtain.js's own look. The towers reach it through a narrower beam.
//
// The frame, in order (docs/proposals/deadball-glass2.md, Lighting and the frame):
//
//   1. shadows: four of the towers draw perspective maps of the players, skinned (gl/spotshadow.js);
//   2. the main pass into hdr.js's target: the sky, the park, the city, the crowd, the backstop
//      net, then the lamps' pools, the Curtain and the spectacle (the comet's tail, sparks off the
//      bat, fireworks: gl/spectacle.js) added over them, each through the night air, which is
//      height fog with the towers' light scattered in it (fog.js);
//   3. the depth the frame was drawn with, resolved into a texture for the lens and the occlusion;
//   4. ambient occlusion from that depth at half size (ssao.js);
//   5. bloom off the lamps (hdr.js), then the lens, the curve and the grade (gl/broadcast.js).
//
// Nothing here decides anything: it draws the park through a shot (diamond/camera.js).
// `createBallparkRenderer` returns null with no WebGL2, no float target, or a shader that won't
// build, and the view falls back to the 2-D Gameday.
//
// ⚠ NO FACE CULLING, as in arena.js: the builders don't keep one winding, and every material
// here is lit from the side that faces the eye.

import { buildPark, crowdMesh, createBatch, ellipsoid, lin, STRIDE, CROWD_STRIDE, CROWD_VERTEX, MAT } from './ballpark-mesh.js';
import { paintInfield, DIRT_RECT } from '../diamond/dirt.js';
import { boardLamps, BOARD_W, BOARD_H } from '../diamond/board.js';
import { shotMatrices, shotOf, inv4 } from '../diamond/camera.js';
import { createHDRLayer } from './hdr.js';
import { HEIGHT_FOG_GLSL, LIGHT_SHAFT_GLSL } from './fog.js';
import { createSpotShadows, SPOT_SHADOW_GLSL } from './spotshadow.js';
import { createDepthSSAO, ssaoConstants } from './ssao.js';
import { createBroadcastPass } from './broadcast.js';
import { makeVertexStream } from './stream.js';
import { declareProgram, prewarmPrograms, takeWarm } from './programs.js';
import { createPlayerSet, buildBody, POSES, mirrorPose, lookOf, faceFor, kitCell, SKIN_STRIDE } from './ballplayer-mesh.js';
import { solvePose, boneFrames, bindFrames, skinRows, BONES, FRAME_FLOATS } from '../diamond/rig.js';
import { BALL_R } from '../diamond/flight.js';
import { SKIN_GLSL, createBonePalette } from './skin.js';
import { bodyKey } from '../diamond/cast.js';
// the view loads this module lazily and takes the cast from it, so the 2-D path never fetches it
export { castOf } from '../diamond/cast.js';
import { paintKitAtlas, paintLogos, paintLeather, paintWood, paintMask } from '../diamond/kits.js';
import { FACE_GLSL, FACE_ATLAS } from '../actor-faces.js';
import { HAIRLINE_GLSL } from '../actor-head.js';
import { buildCityscape, FACADE_GLSL, STREET_GLSL } from './cityscape.js';
import { composeSet } from '../../../../shared/city-set.js';
import { CURTAIN_FRAG } from './curtain.js';
import { applyLinOut } from './colour.js';
import { HUD_FACES, loadHudFaces } from '../diamond/hud.js';
import { createSpectacle } from './spectacle.js';

const FACE = '"Arial Narrow", "Roboto Condensed", Arial, sans-serif';

// ── shaders ─────────────────────────────────────────────────────────────────
const LIT_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aCol;
layout(location = 4) in float aMat;
uniform mat4 uVP;
out vec3 vPos; out vec3 vNrm; out vec2 vUv; out vec3 vCol; flat out int vMat;
void main() { vPos = aPos; vNrm = aNrm; vUv = aUv; vCol = aCol; vMat = int(aMat + 0.5); gl_Position = uVP * vec4(aPos, 1.0); }`;
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

// What every lit pass shares: the six towers, the sky's ambient, and the night air.
const LIGHTS_GLSL = `
const float PI = 3.14159265;
uniform vec3 uLPos[6]; uniform vec3 uLCol[6]; uniform vec3 uLDir[6];
uniform vec3 uEye; uniform vec3 uSkyUp; uniform vec3 uSkyDn;
uniform vec3 uFogCol; uniform float uFogDens; uniform float uFogH; uniform float uShaft; uniform float uShaftReach;
// a flood's cone: full inside 32° of its axis, falling to a spill at 63°
float spotOf(int i, vec3 L, float spill) { return mix(spill, 1.0, smoothstep(0.45, 0.85, dot(-L, uLDir[i]))); }
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

// The park's outer wall (ballpark-mesh.js buildExterior), in the manner of the city ballparks of
// the early 1990s: brick piers, a ground arcade lit from the concourse, a band of arched windows
// with the club level lit behind, an open steel tier under the upper deck with its ceiling lamps
// showing, cast-stone bands and a cornice, and the floods at its foot washing the brick. vUv is
// (feet along, feet up); vCol is (seed, height / 100, 1 for the outfield's lower wall).
const EXTERIOR_GLSL = `
float wallHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void exterior(out vec3 alb, out float rough, out float f0s, out vec3 emis) {
  float u = vUv.x, v = vUv.y, H = vCol.g * 100.0; bool outfield = vCol.b > 0.5;
  const float BAY = 26.0; float bu = (fract(u / BAY) - 0.5) * BAY; float bayI = floor(u / BAY);
  vec2 fw = fwidth(vUv) + 1e-3;
  vec4 n1 = texture(uGrass, vUv / 6.0);
  // brick, coursed, the coursing fading out with distance
  float course = abs(fract(v / 0.22) - 0.5), cfw = fwidth(v / 0.22);
  float mortar = (1.0 - smoothstep(0.38, 0.38 + cfw * 1.5, course)) * (1.0 - smoothstep(0.2, 0.6, cfw));
  vec3 brick = vec3(0.20, 0.068, 0.040) * (0.82 + 0.3 * n1.r) * (1.0 - 0.25 * (1.0 - mortar));
  vec3 stone = vec3(0.34, 0.30, 0.24) * (0.9 + 0.15 * n1.g);
  vec3 steel = vec3(0.020, 0.060, 0.045);
  alb = brick; rough = 0.86; f0s = 0.03; emis = vec3(0.0);
  // the piers stand between the openings, at the bay's ends
  float pier = smoothstep(9.5, 9.5 + fw.x * 2.0, abs(bu));
  // the arcade: openings about seventeen feet wide, round heads springing at sixteen feet
  float aw = 8.6, spring = 16.0;
  float dA = (v < spring) ? abs(bu) - aw : length(vec2(bu, v - spring)) - aw;
  float arch = 1.0 - smoothstep(-fw.x, fw.x, dA);
  float voussoir = (1.0 - smoothstep(0.0, 1.6, abs(dA - 0.8))) * step(spring - 1.0, v);
  alb = mix(alb, stone, voussoir * 0.85);
  // the concourse behind the arches, lit from its ceiling, people moving against it
  float ceilG = smoothstep(2.0, spring + aw, v);
  float crowd = step(v, 6.4) * smoothstep(0.3, 0.7, wallHash(vec2(floor(u / 1.6), 3.0)));
  vec3 inside = vec3(1.0, 0.70, 0.40) * (0.35 + 0.9 * ceilG) * (1.0 - 0.75 * crowd);
  alb = mix(alb, vec3(0.02), arch); rough = mix(rough, 0.6, arch);
  emis += inside * arch * 0.12;
  // cast-stone bands over the arcade and at the cornice
  float band1 = step(abs(v - 26.0), 1.2), corn = step(H - 3.5, v);
  alb = mix(alb, stone, max(band1, corn));
  if (!outfield && H > 60.0) {
    // arched windows on the second tier, the club level lit behind them
    float wv = 31.0, wt = 41.0, ww = 4.2;
    float dW = (v < wt) ? max(abs(bu) - ww, wv - v) : length(vec2(bu, v - wt)) - ww;
    float win = 1.0 - smoothstep(-fw.x, fw.x, dW);
    float clubLit = step(0.25, wallHash(vec2(bayI, 11.0)));
    alb = mix(alb, vec3(0.015, 0.017, 0.02), win); rough = mix(rough, 0.12, win); f0s = mix(f0s, 0.06, win);
    emis += vec3(1.0, 0.82, 0.58) * win * clubLit * (0.05 + 0.1 * smoothstep(wv, wt + ww, v));
    alb = mix(alb, stone, step(abs(v - 50.0), 1.0));
    // the open steel tier: green columns and braces, and behind them the upper concourse in
    // shadow, its ceiling lamps in a row and the deck's underside catching their light
    if (v > 52.0 && v < H - 4.0) {
      float col = 1.0 - smoothstep(1.4, 1.4 + fw.x * 2.0, abs(bu));
      float brace = (1.0 - smoothstep(0.5, 0.5 + fw.x * 2.0, abs(abs(bu) - (v - 52.0) * 0.5))) * step(v, 76.0);
      float rail = step(abs(v - 56.0), 0.35) + step(abs(v - 59.0), 0.25);
      float frame = clamp(col + brace + rail, 0.0, 1.0);
      vec2 lp = vec2(fract(u / 13.0) - 0.5, v - (H - 9.0));
      float lampDot = exp(-dot(lp * vec2(13.0, 1.0), lp * vec2(13.0, 1.0)) / 0.5);
      float soffit = smoothstep(H - 16.0, H - 6.0, v);
      vec3 upper = vec3(1.0, 0.84, 0.62) * (0.012 + 0.05 * soffit + 1.6 * lampDot);
      alb = mix(vec3(0.01), steel, frame); rough = mix(0.7, 0.45, frame);
      emis += upper * (1.0 - frame);
    }
  }
  // the piers stay brick through the arcade
  alb = mix(alb, brick * 1.08, pier * (1.0 - band1) * (1.0 - corn) * step(v, 50.0) * (1.0 - voussoir));
  emis *= 1.0 - pier * step(v, 50.0);
  // the floods at the wall's foot: warm light up the brick, strongest on the piers
  float wash = exp(-v / 34.0) * (0.55 + 0.45 * pier) * (0.8 + 0.2 * cos(bu * 0.24));
  emis += alb * vec3(1.0, 0.78, 0.55) * wash * 2.4 * (1.0 - arch);
}
`;

const LIT_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNrm; in vec2 vUv; in vec3 vCol; flat in int vMat;
uniform sampler2D uTex; uniform sampler2D uDirt; uniform sampler2D uGrass; uniform sampler2D uBoard;
uniform int uTextured; uniform float uAlphaTest; uniform float uAlpha; uniform float uEmis;
uniform vec3 uFence; uniform vec2 uBoardRes; uniform vec3 uBoardOn;
uniform float uCityLit; uniform float uPoolK;
uniform int uLSh[6]; uniform int uSpotN;
uniform sampler2D uFaceAtlas;
// a skinned player's slot: his face's place in the head arrays, and his jersey's cell in the kit
// atlas (gl/ballplayer-mesh.js KIT_REL); 0 and no cell for everything else
uniform int uHeadSlot; uniform vec4 uKitCell;
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
  }
  vec3 alb = vCol * tex.rgb;
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
    // a face of lamps: each cell of the grid is one lamp, lit where the mask says
    vec2 g = vUv * uBoardRes, f = fract(g) - 0.5;
    float on = texture(uBoard, (floor(g) + 0.5) / uBoardRes).r;
    float fw = max(fwidth(g.x), fwidth(g.y));
    float disc = 1.0 - smoothstep(0.3 - fw * 0.5, 0.4 + fw * 0.5, length(f));
    disc = mix(disc, 0.42, smoothstep(0.6, 1.4, fw));
    o = vec4(airOf(mix(vec3(0.02, 0.01, 0.004), uBoardOn, on) * disc + vec3(0.003) * (1.0 - disc), vPos), 1.0);
    return;
  }
  float rough = 0.85, metal = 0.0, wrap = 0.0, f0s = 0.04, ao = 1.0;
  vec3 emis = vec3(0.0);
  // the city and the park's outside stand past where the floods are aimed (below)
  bool far = vMat == ${MAT.FACADE} || vMat == ${MAT.STREET} || vMat == ${MAT.EXTERIOR};
  if (vMat == ${MAT.FACADE}) { facade(alb, rough, f0s, emis, metal); ao = mix(0.62, 1.0, smoothstep(0.0, 1.6, vPos.y)); }
  else if (vMat == ${MAT.STREET}) { street(alb, rough, f0s); }
  else if (vMat == ${MAT.EXTERIOR}) {
    // from inside the park its back is plain
    if (dot(N, V) < 0.0) { alb = vec3(0.022, 0.021, 0.02); rough = 0.95; N = -N; }
    else exterior(alb, rough, f0s, emis);
    ao = mix(0.62, 1.0, smoothstep(0.0, 1.6, vPos.y));
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
    // outside the field, under the stands: concrete
    float d1 = (xz.x + xz.y) * 0.7071, d3 = (xz.y - xz.x) * 0.7071;
    bool field = (r < wr + 2.0 && xz.y > -30.0 && min(d1, d3) > -40.0) || r < 58.0;
    if (!field) { alb = vec3(0.060, 0.058, 0.055) * (0.85 + 0.3 * g2.g); dirt.a = 1.0; }
    N = normalize(vec3((g1.r - 0.5) * 0.18 * (1.0 - dirt.a) + (g3.b - 0.5) * 0.12, 1.0, (g1.g - 0.5) * 0.12));
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
    // what's near the ground sees less of the sky
    float aoH = mix(0.62, 1.0, smoothstep(0.0, 1.6, vPos.y));
    if (vMat >= ${MAT.HEAD} && vMat <= ${MAT.NECK}) { headShade(alb, rough, f0s, wrap, ao); ao *= aoH; }
    else ao = aoH;
  }
  vec3 f0 = mix(vec3(f0s), alb, metal);
  vec3 dif = alb * (1.0 - metal);
  float a = max(rough * rough, 0.003);
  float NoV = max(dot(N, V), 1e-3);
  vec3 col = dif * mix(uSkyDn, uSkyUp, N.y * 0.5 + 0.5) * ao;
  vec3 R = reflect(-V, N);
  vec3 env = mix(uSkyDn * 1.4, uSkyUp * 2.2, clamp(R.y * 0.6 + 0.5, 0.0, 1.0));
  vec3 Fv = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - NoV, 5.0);
  col += env * Fv * ao * (1.0 - rough * 0.6);
  for (int i = 0; i < 6; i++) {
    vec3 Lv = uLPos[i] - vPos; float d = length(Lv); vec3 L = Lv / d;
    float NoL = dot(N, L);
    float wd = max((NoL + wrap) / (1.0 + wrap), 0.0), nl = max(NoL, 0.0);
    vec3 H = normalize(L + V); float NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
    vec3 F = f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
    vec3 spec = ggxD(NoH, a) * visSG(NoV, nl, a) * F;
    // the four towers that cast throw this point into shadow where a caster stands between
    float sh = (uLSh[i] >= 0 && uLSh[i] < uSpotN) ? spotShadow(uLSh[i], vPos + N * 0.04) : 1.0;
    vec3 rad = uLCol[i] * spotOf(i, L, far ? 0.012 : 0.05) * mix(sh, 1.0, 0.08) * exp(-max(d - 700.0, 0.0) / 240.0);
    // past the field: a narrower beam and the inverse square, so the faces toward the park catch
    // some light and no more
    if (far) rad *= smoothstep(0.80, 0.97, dot(-L, uLDir[i])) * 0.9 + 0.12 * min(1.0, pow(260.0 / d, 2.0));
    col += (dif / PI * wd * (vMat == ${MAT.GROUND} ? 0.45 + 0.55 * ao : 1.0) + spec * nl) * rad;
    // light through skin: a warm wrap past the terminator
    if (vMat == ${MAT.SKIN} || vMat == ${MAT.HEAD} || vMat == ${MAT.EAR} || vMat == ${MAT.NECK}) col += alb * vec3(0.10, 0.025, 0.01) * max(wd - nl, 0.0) * rad;
  }
  // cloth has a sheen at grazing angles
  if (vMat == ${MAT.CLOTH}) col += dif * pow(1.0 - NoV, 4.0) * 0.05 * uSkyUp;
  // what lights itself: windows, the arcade, the floods at the wall's foot
  col += emis * uCityLit;
  o = vec4(airOf(col, vPos), uAlpha * tex.a);
}`;

const CROWD_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec3 aNrm; layout(location = 2) in float aPart;
layout(location = 3) in vec4 iA; layout(location = 4) in vec4 iB; layout(location = 5) in vec3 iC;
uniform mat4 uVP;
out vec3 vPos; out vec3 vN; out vec3 vAlb;
void main() {
  float c = cos(iA.w), s = sin(iA.w); vec3 p = aPos * iB.w;
  vec3 w = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + iA.xyz;
  vN = vec3(c * aNrm.x + s * aNrm.z, aNrm.y, -s * aNrm.x + c * aNrm.z);
  float h = fract(sin(dot(iA.xz, vec2(12.99, 78.23))) * 43758.5);
  vec3 pants = mix(vec3(0.03, 0.04, 0.07), vec3(0.12, 0.10, 0.07), h);
  vAlb = aPart < 0.5 ? iC : (aPart < 1.5 ? iB.rgb : (aPart < 2.5 ? pants : (aPart < 3.5 ? vec3(0.02, 0.016, 0.012) + 0.05 * h : vec3(0.82, 0.62, 0.16))));
  vPos = w; gl_Position = uVP * vec4(w, 1.0);
}`;
const CROWD_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vN; in vec3 vAlb;
out vec4 o;
${LIGHTS_GLSL}
void main() {
  vec3 N = normalize(vN);
  vec3 col = vAlb * mix(uSkyDn, uSkyUp, N.y * 0.5 + 0.5) * 0.5;
  for (int i = 0; i < 6; i++) { vec3 L = normalize(uLPos[i] - vPos); col += vAlb / PI * max(dot(N, L) * 0.8 + 0.2, 0.0) * uLCol[i] * spotOf(i, L, 0.04) * 0.55; }
  o = vec4(airOf(col, vPos), 1.0);
}`;

// A full-screen triangle with no vertex buffer, as hdr.js draws its passes.
const FULL_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
// The night sky: horizon to zenith, the city's glow low down, and a few stars.
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform mat4 uInvVP; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGlow; uniform float uStars;
${LIGHTS_GLSL}
void main() {
  vec4 p = uInvVP * vec4(vUV * 2.0 - 1.0, 1.0, 1.0); vec3 rd = normalize(p.xyz / p.w - uEye);
  float el = rd.y;
  vec3 col = mix(uHor, uZen, smoothstep(-0.02, 0.55, el)) + uGlow * exp(-max(el, 0.0) * 12.0);
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

for (const [vs, fs] of [[LIT_VS, LIT_FS], [SKIN_VS, LIT_FS], [SKIN_DEPTH_VS, DEPTH_FS], [CROWD_VS, CROWD_FS], [FULL_VS, SKY_FS], [FULL_VS, FINAL_FS], [CURTAIN_VS, CURTAIN_FRAG]]) declareProgram(vs, fs);

// The textures whose clear texels are holes: the wall's distances, the monograms, the masks' bars.
const ALPHA_TEST = new Set(['nums', 'logo', 'mask']);

// The night: the sky's colours, its ambient, how hard the towers burn, and the air: a haze that
// thins over 160 ft of height, and how much of the towers' light it scatters.
const NIGHT = {
  up: [0.006, 0.008, 0.016], dn: [0.024, 0.032, 0.017], zen: [0.0018, 0.0024, 0.0065], hor: [0.005, 0.006, 0.009],
  glow: [0.010, 0.008, 0.006], towers: 3.6,
  fog: [0.004, 0.0045, 0.0055], fogDens: 0.00022, fogH: 160, shaft: 1.0, shaftReach: 260,
  // the city: its windows and the park's arcade, the lamps' pools, the Curtain (well down from the
  // flight sim's strength, so the field stays the brightest thing in the picture), the park's sign
  cityLit: 1.5, pool: 0.032, curtain: 0.32, sign: 9,
};

// The quality rungs the view's governor steps through, cheapest last: the lens's taps, the
// occlusion, then the resolution.
export const BALLPARK_RUNGS = [
  { dpr: 2, dof: 28, ao: true }, { dpr: 2, dof: 12, ao: true }, { dpr: 1.5, dof: 12, ao: false }, { dpr: 1.25, dof: 0, ao: false }, { dpr: 1, dof: 0, ao: false },
];

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
    const LIT = prog(LIT_VS, LIT_FS), CROWD = prog(CROWD_VS, CROWD_FS), SKY = prog(FULL_VS, SKY_FS), FINAL = prog(FULL_VS, FINAL_FS);
    const CURT = prog(CURTAIN_VS, CURTAIN_FRAG);
    const SKLIT = prog(SKIN_VS, LIT_FS), SKD = prog(SKIN_DEPTH_VS, DEPTH_FS);
    const spectacle = createSpectacle(gl, prog);

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
    const crowd = [];
    for (const kind of ['sit', 'stand', 'cheer']) {
      const inst = park.crowd[kind];
      if (!inst.length) continue;
      const mesh = crowdMesh(kind, { far: opts.crowd !== 'near', towels: !!opts.towels });
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const mb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mb); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
      const VS = CROWD_VERTEX * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VS, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VS, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, VS, 24);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
      const IS = CROWD_STRIDE * 4;
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, IS, 0); gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, IS, 16); gl.vertexAttribDivisor(4, 1);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 3, gl.FLOAT, false, IS, 32); gl.vertexAttribDivisor(5, 1);
      gl.bindVertexArray(null);
      crowd.push({ vao, n: mesh.length / CROWD_VERTEX, count: inst.length / CROWD_STRIDE, buffers: [mb, ib] });
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
    const dropBody = (body) => { for (const b of body.batches) { gl.deleteVertexArray(b.vao); gl.deleteBuffer(b.buf); } };
    // the bind frames by build scale (a pitcher stands a little taller)
    const binds = new Map();
    const bindOf = (scale) => { let b = binds.get(scale); if (!b) binds.set(scale, (b = bindFrames(scale))); return b; };
    const frames = new Float32Array(BONES.length * FRAME_FLOATS), skinBuf = new Float32Array(BONES.length * 12);
    // A pose into a slot's row of the palette: a pose table entry with `at`, `yaw` and `scale`.
    function setPose(slot, pose) {
      palette.write(slot, skinRows(boneFrames(solvePose(pose), frames), bindOf(pose.scale || 1), skinBuf));
    }
    function setCast(cast, teams) {
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
      const lk = `${teams?.home}|${teams?.away}`;
      if (lk !== logoKey) {
        logoKey = lk;
        if (TEX.logo) gl.deleteTexture(TEX.logo);
        TEX.logo = texture(paintLogos(doc, teams), { repeat: false });
      }
      // who stays, who goes, who's to be built
      const want = new Map(cast.map((c) => [bodyKey(c), c]));
      for (const [k, body] of bodies) if (!want.has(k)) { dropBody(body); bodies.delete(k); }
      queue = [...want].filter(([k]) => !bodies.has(k));
      members = cast.map((c) => ({ key: bodyKey(c), slot: c.look.slot }));
      HA.fill(0); HB.fill(0); HC.fill(0); HD.fill(0);
      for (const c of cast) {
        const look = lookOf({ ...c.look });
        const f = faceFor(look), i = c.look.slot * 4;
        HA.set([...f.skin, f.layout], i); HB.set([...f.hair, f.style], i); HC.set([...f.iris, f.eyeBlack], i); HD.set([...f.lip, f.seed], i);
        // each where the cast stands him, until something moves him
        setPose(c.look.slot, Object.assign(c.mirror ? mirrorPose(POSES[c.pose]()) : POSES[c.pose](), { at: c.at, yaw: c.yaw, scale: c.scale }));
      }
      refreshCasters();
      return queue.length;
    }
    // Builds queued bodies for up to `budget` ms. Returns how many are still to build.
    function pump(budget = 12) {
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < budget) {
        const [key, c] = queue.shift();
        const G = createPlayerSet({ skin: true });
        buildBody(G, lookOf({ ...c.look, scale: c.scale }));
        bodies.set(key, { batches: [...G.batches].map(([k, b]) => ({ key: k, ...uploadSkin(b) })) });
      }
      refreshCasters();
      return queue.length;
    }
    // what casts the towers' shadows: each player with his body, in his row of the palette
    function refreshCasters() {
      api.casters = members.filter((m) => bodies.has(m.key)).map((m) => ({ slot: m.slot, batches: bodies.get(m.key).batches }));
    }

    // ── the city round the park, and the park's name over its gate ─────────────
    // From the league's venue (venue.js): the content's site and art direction and the server's
    // skyline. The set is composed round this park's own outline (client/shared/city-set.js) and
    // built once (gl/cityscape.js), then each frame only draws it. A new venue replaces it.
    let city = null, cityVenue = null;
    TEX.sign = null;
    function setVenue(v) {
      if (lost || !v || v === cityVenue) return city?.stats || null;
      cityVenue = v;
      dropCity();
      if (v.site && v.skyline) {
        const art = v.city || null;
        const set = composeSet({ site: v.site, skyline: v.skyline, outline: park.outline, art });
        const c = buildCityscape(set, { art, outline: park.outline });
        city = {
          opaque: [...c.opaque].map(([key, b]) => ({ key, ...upload(b) })),
          glow: [...c.glow].map(([key, b]) => ({ key, ...upload(b) })),
          curtain: uploadCurtain(c.curtain, set.T),
          stats: { ...c.stats, placed: set.placed.length, unplaced: set.unplaced.length, bearing: set.bearing.median },
        };
      }
      paintSign(v.name);
      return city?.stats || null;
    }
    function dropCity() {
      if (!city) return;
      for (const d of [...city.opaque, ...city.glow]) { gl.deleteVertexArray(d.vao); gl.deleteBuffer(d.st.buf); }
      if (city.curtain) { gl.deleteVertexArray(city.curtain.vao); gl.deleteBuffer(city.curtain.st.buf); }
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
    // The name in lit letters on a dark face, in the graphics' own face once it has loaded.
    function paintSign(name) {
      if (TEX.sign) { gl.deleteTexture(TEX.sign); TEX.sign = null; }
      const text = String(name || '').trim().toUpperCase();
      if (!text) return;
      const draw = () => canvasOf(doc, 2048, 264, (g) => {
        g.fillStyle = '#0c0e12'; g.fillRect(0, 0, 2048, 264);
        g.strokeStyle = '#ffbe5a'; g.lineWidth = 6; g.strokeRect(10, 10, 2028, 244);
        g.font = HUD_FACES.big(150); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffd68c';
        g.fillText(text, 1024, 140, 1900);
      });
      TEX.sign = texture(draw(), { repeat: false, af: 16 });
      loadHudFaces(doc).then((ok) => {
        if (!ok || lost || cityVenue?.name !== name || !TEX.sign) return;
        gl.deleteTexture(TEX.sign);
        TEX.sign = texture(draw(), { repeat: false, af: 16 });
        opts.onAsset?.();
      });
    }
    const signDraw = { key: 'sign', ...upload(park.sign) };

    // ── the ball ──────────────────────────────────────────────────────────────
    // Where the director's world has it (diamond/world.js), or nowhere. A sphere a little over its
    // real size, so a pitch reads on a 400-pixel screen, rewritten into one stream when it moves.
    const BALL_DRAWN = BALL_R * 1.4;
    const ballBatch = createBatch(256), ballDraw = { key: 'ball', ...upload(createBatch(1)) };
    let ballAt = null;
    function setBall(p) {
      ballAt = p && p.every(Number.isFinite) ? p.slice() : null;
      if (!ballAt) return;
      ballBatch.n = 0;
      ellipsoid(ballBatch, ballAt, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [BALL_DRAWN, BALL_DRAWN, BALL_DRAWN], 8, 12, lin('#f2efe6'), MAT.SATIN);
      ballDraw.st.write(ballBatch.data, ballBatch.n * STRIDE);
      ballDraw.n = ballBatch.n;
    }

    // ── the lights ────────────────────────────────────────────────────────────
    // Each tower burns in proportion to its working lamps; the two behind the plate are
    // smaller banks.
    const LPos = new Float32Array(18), LCol = new Float32Array(18), LDir = new Float32Array(18);
    park.field.towers.slice(0, 6).forEach((T, i) => {
      const k = NIGHT.towers * (T.frac / 0.62) * (T.base[2] < 0 ? 0.7 : 1);
      LPos.set(T.lamp, i * 3); LCol.set([k, k * 0.965, k * 0.9], i * 3); LDir.set(T.dir, i * 3);
    });
    const fence = park.field.fence;
    // the four towers on the field side cast; the two behind the plate don't
    const LSh = new Int32Array(6).fill(-1);
    { let k = 0; park.field.towers.slice(0, 6).forEach((T, i) => { if (T.base[2] >= 0 && k < shadows.count) LSh[i] = k++; }); }
    const casting = park.field.towers.filter((T, i) => LSh[i] >= 0);

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

    let lost = false;
    canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); lost = true; api.lost = true; });
    const stats = { tris: 0, draws: 0, ms: 0 };

    function lights(P, eye) {
      gl.uniform3fv(P.u('uLPos'), LPos); gl.uniform3fv(P.u('uLCol'), LCol); gl.uniform3fv(P.u('uLDir'), LDir);
      gl.uniform3fv(P.u('uEye'), eye); gl.uniform3fv(P.u('uSkyUp'), NIGHT.up); gl.uniform3fv(P.u('uSkyDn'), NIGHT.dn);
      const q = api.quality;
      gl.uniform3fv(P.u('uFogCol'), NIGHT.fog); gl.uniform1f(P.u('uFogDens'), q.fog ? NIGHT.fogDens : 0); gl.uniform1f(P.u('uFogH'), NIGHT.fogH);
      gl.uniform1f(P.u('uShaft'), q.fog ? NIGHT.shaft : 0); gl.uniform1f(P.u('uShaftReach'), NIGHT.shaftReach);
    }

    // ── a frame ───────────────────────────────────────────────────────────────
    function render(shot) {
      if (lost) return false;
      const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
      const w = canvas.width, h = canvas.height;
      if (!(w > 0 && h > 0)) return false;
      const M = shotMatrices(shot, w / h), q = api.quality;
      let tris = 0, draws = 0;

      // the players' poses, sent once for the shadows and the picture both
      palette.upload();

      // 1. the towers' shadows, of whatever casts: the players, skinned
      let spotN = 0;
      const casters = api.casters;
      if (q.shadows && casters.length) {
        const [focus, radius] = M.shadow || [[0, 0, 60], 80];
        spotN = shadows.render(casting.map((T) => ({ lamp: T.lamp, focus, radius })), (vp, own) => {
          gl.useProgram(SKD.p);
          gl.uniformMatrix4fv(SKD.u('uVP'), false, vp);
          palette.bind(9); gl.uniform1i(SKD.u('uBones'), 9);
          for (const c of casters) {
            gl.uniform1i(SKD.u('uBoneRow'), c.slot);
            for (const b of c.batches) { gl.bindVertexArray(b.vao); gl.drawArrays(gl.TRIANGLES, 0, b.n); }
          }
          gl.bindVertexArray(null);
          gl.useProgram(own);
        });
      }

      if (!hdr.bind(w, h)) return false;
      gl.clearColor(0, 0, 0, 1); gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);

      // the sky, behind everything
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(SKY.p);
      lights(SKY, M.eye);
      gl.uniformMatrix4fv(SKY.u('uInvVP'), false, inv4(M.viewProj));
      gl.uniform3fv(SKY.u('uZen'), NIGHT.zen); gl.uniform3fv(SKY.u('uHor'), NIGHT.hor); gl.uniform3fv(SKY.u('uGlow'), NIGHT.glow); gl.uniform1f(SKY.u('uStars'), 1);
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
        gl.uniform1f(P.u('uCityLit'), NIGHT.cityLit); gl.uniform1f(P.u('uPoolK'), NIGHT.pool);
        shadows.bind(P.u, 4);
        gl.uniform1iv(P.u('uLSh'), LSh); gl.uniform1i(P.u('uSpotN'), spotN);
        gl.uniform1i(P.u('uHeadSlot'), 0); gl.uniform4f(P.u('uKitCell'), 0, 0, 0, 0);
      };
      const drawSet = (list, alpha, P = LIT) => {
        for (const d of list) {
          const t = TEX[d.key];
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(T2, t || null);
          gl.uniform1i(P.u('uTextured'), t ? 1 : 0);
          gl.uniform1f(P.u('uAlphaTest'), ALPHA_TEST.has(d.key) ? 0.5 : -1);
          gl.uniform1f(P.u('uAlpha'), alpha);
          gl.uniform1f(P.u('uEmis'), d.key === 'sign' ? NIGHT.sign : 1);
          gl.bindVertexArray(d.vao); gl.drawArrays(gl.TRIANGLES, 0, d.n);
          tris += d.n / 3; draws++;
        }
      };
      litSetup(LIT);
      drawSet(opaque, 1);
      if (TEX.sign) drawSet([signDraw], 1);
      if (ballAt) drawSet([ballDraw], 1);
      if (city) drawSet(city.opaque, 1);
      // the players: each one's bones from his row of the palette (unit 9), his face from the atlas
      // (unit 8) and the head arrays, his jersey from his slot's cell
      litSetup(SKLIT);
      gl.uniform1i(SKLIT.u('uFaceAtlas'), 8); gl.uniform1i(SKLIT.u('uBones'), 9);
      gl.uniform4fv(SKLIT.u('uHeadA'), HA); gl.uniform4fv(SKLIT.u('uHeadB'), HB); gl.uniform4fv(SKLIT.u('uHeadC'), HC); gl.uniform4fv(SKLIT.u('uHeadD'), HD);
      for (const m of members) {
        const body = bodies.get(m.key);
        if (!body) continue;
        const cell = kitCell(m.slot);
        gl.uniform1i(SKLIT.u('uBoneRow'), m.slot); gl.uniform1i(SKLIT.u('uHeadSlot'), m.slot);
        gl.uniform4f(SKLIT.u('uKitCell'), cell[0], cell[1], cell[2], cell[3]);
        drawSet(body.batches, 1, SKLIT);
      }

      // the crowd
      if (crowd.length) {
        gl.useProgram(CROWD.p);
        lights(CROWD, M.eye);
        gl.uniformMatrix4fv(CROWD.u('uVP'), false, M.viewProj);
        for (const d of crowd) { gl.bindVertexArray(d.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, d.n, d.count); tris += d.n / 3 * d.count; draws++; }
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
      const fx = spectacle.draw(M);
      tris += fx.tris; draws += fx.draws;
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
      const ao = D && q.ao && ssao ? ssao.render(D.tex, Math.max(1, w >> 1), Math.max(1, h >> 1), ssaoConstants(M.proj), { radius: 2.0, bias: 0.05, slope: 3 }) : null;

      // 5. the lens, the curve and the grade onto the canvas
      if (bc && bc.render({
        scene: res.scene, bloom: res.bloom, depth: D ? D.tex : null, ao, w, h, near: M.near, far: M.far,
        focus: Math.hypot(M.at[0] - M.eye[0], M.at[1] - M.eye[1], M.at[2] - M.eye[2]), dof: M.dof || 0, taps: q.dof,
        exposure: q.exposure, bloomK: q.bloom, aoK: q.aoK ?? 0.75, grade: q.grade, tube: q.tube, seed: 3.7,
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
      gl.uniform1f(FINAL.u('uExp'), api.quality.exposure);
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
        shadows.dispose(); ssao?.dispose(); bc?.dispose(); spectacle.dispose();
        if (depth) { gl.deleteFramebuffer(depth.fbo); gl.deleteTexture(depth.tex); depth = null; }
        for (const t of Object.values(TEX)) gl.deleteTexture(t);
        gl.deleteTexture(boardTex);
        for (const d of [...opaque, ...translucent, signDraw, ballDraw]) { gl.deleteVertexArray(d.vao); gl.deleteBuffer(d.st.buf); }
        dropCity();
        for (const d of crowd) { gl.deleteVertexArray(d.vao); for (const b of d.buffers) gl.deleteBuffer(b); }
        for (const body of bodies.values()) dropBody(body);
        bodies.clear();
        palette.dispose();
        hdr.dispose();
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch { /* a lost context has nothing left to free */ }
      lost = true; api.lost = true;
    }

    const api = {
      kind: 'gl', lost: false, rungs: BALLPARK_RUNGS,
      // grade: 'arcade', 'broadcast' or 'none'; tube: the tube glass; dof: the lens's taps (0 off)
      quality: { dpr: 2, bloom: 0.18, exposure: 1.0, grade: opts.grade || 'arcade', tube: !!opts.tube, ao: true, dof: 28, shadows: true, fog: true },
      // what casts the towers' shadows: the players, [{ slot, batches }], skinned from the palette
      casters: [],
      // setPose(slot, pose): a player into a pose from the rig's pose language, with at, yaw, scale;
      // setBall(point or null): the ball, in the park's feet; setSpectacle(effects, t): the
      // payload's spectacle (diamond/spectacle.js) and the world's time to draw it at
      render, setBoard, setCast, setPose, setBall, setSpectacle: (fx, t) => spectacle.set(fx, t), pump, setVenue, dispose, stats,
      pending: () => queue.length,
      get park() { return park; },
      // what the city came to: { buildings, filler, lamps, tris, placed, bearing, … }, or null
      get city() { return city?.stats || null; },
      get players() { return bodies.size; },
    };
    return api;
  }
}
