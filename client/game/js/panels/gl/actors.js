// PAVEMENT PEOPLE AS INSTANCED MESHES, THEIR CLIPS BAKED INTO A TEXTURE.
//
// The close-up half of the street-actor layer. windshield.js decides who is drawn this way (anybody
// big enough on screen, on GLASS 2, once the bake has finished) and hands each of them over as a
// record in the solids list with `actor: 1`; context.js splits those out to here. A record with
// `lod: 1` is somebody a few pixels tall and draws the far body (actor3d.js bk.far), a second mesh on
// the same clips; smaller than RENDER_TUNE.actorFarPx is still the billboard drawActorFigure bakes.
//
// It is gl/fauna.js's scheme with two changes. The mesh is one skinned body from actor3d.js, and its
// clips live in two RGBA16F textures (positions and normals), a column per vertex and a band of rows
// per frame. And an instance can blend two clips, so somebody who stops walking settles into standing
// over a few hundred milliseconds instead of snapping to it.
//
// The shading is the camp shelters' rule from windshield.js: a key-light dot against the frame's own
// light direction, brighter faces toward the sky, and the blob's night dimming, all times the outfit
// colour. Fog, blending and depth are fauna.js's, so a person and a goose on the same pavement fade
// into the haze the same way.
//
// THE HEAD is its own program (HEAD_VERT, HEAD_FRAG): the bake's near body has none, and actor-head.js's
// skull, ears, neck and hair ride the head and neck bones the bake writes (bk.bones), with a face from
// the baked atlas (actor-faces.js) tinted per person. A record's `hl` is its head level (headLevelFor);
// one instanced draw per level for the skulls and one per level and hair style for the hair, drawn
// from one instance buffer sorted that way. docs/proposals/street-figure-heads.md is the plan.
import { viewProjMatrix, viewMatrix } from './camera.js';
import { makeVertexStream } from './stream.js';
import { actorBakeReady, ACTOR_HEAD_BONES } from '../actor3d.js';
import { headMesh, hairMesh, HEAD_LEVELS, HAIR_STYLES, FACE, HAIRLINE_GLSL } from '../actor-head.js';
import { FACE_ATLAS, FACE_GLSL } from '../actor-faces.js';
import { declareProgram, takeWarm } from './programs.js';
import { linearOut, applyLinOut } from './colour.js';

// Per instance: x, y, z, tiles per metre | clip A row0, frames, phase, heading | clip B row0, frames,
// phase, share of B | coat rgb | trousers rgb | skin rgb | hair rgb | shoes rgb | brightness, alpha |
// materials (coat + trousers·8 + shoes·64, ACTOR_MATERIAL codes)
const STRIDE = 30;
// Units no other layer binds: 0-5 are the world pass's, 7 is fauna.js's pose, 8-17 are the
// murmuration's simulation and its drawing.
const POS_UNIT = 20, NRM_UNIT = 21;
// The look: 1 is seams, grime and the fuller light (see FRAG), 0 the flat shading as first shipped.
// `mat` 1 lights each garment as what it's made of (satin, leather, vinyl, metal; see envAt), 0 lights
// everything as cloth. Flip either from the console to compare.
export const ACTOR_LOOK = { on: 1, mat: 1 };

const VERT = `#version 300 es
precision highp float;
precision highp int;
in float aMat;
in vec3 aRest;
in vec4 iPos;
in vec4 iClipA;
in vec4 iClipB;
in vec3 iCoat;
in vec3 iLegs;
in vec3 iSkin;
in vec3 iHair;
in vec3 iShoe;
in vec2 iLit;
in float iMats;
uniform highp sampler2D uPosT;
uniform highp sampler2D uNrmT;
uniform int uW;
uniform int uRows;
uniform mat4 uViewProj;
uniform mat4 uView;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
out vec3 vColor;
out vec3 vN;
out vec3 vNv;
out vec3 vRest;
flat out int vMat;
flat out int vMk;
out vec3 vNm;
out vec3 vW;
out vec3 vWT;
out vec3 vToEye;
out float vFog;
out float vAlpha;
out float vLum;
ivec2 texel(int f) { return ivec2(gl_VertexID % uW, f * uRows + gl_VertexID / uW); }
// One clip at one phase: the two baked frames either side of it, blended.
void clipAt(vec4 c, out vec3 p, out vec3 n) {
  float fr = fract(c.z) * c.y;
  int f0 = int(fr);
  int f1 = f0 + 1;
  if (float(f1) >= c.y) f1 = 0;
  float t = fr - float(f0);
  int b = int(c.x + 0.5);
  p = mix(texelFetch(uPosT, texel(b + f0), 0).xyz, texelFetch(uPosT, texel(b + f1), 0).xyz, t);
  n = mix(texelFetch(uNrmT, texel(b + f0), 0).xyz, texelFetch(uNrmT, texel(b + f1), 0).xyz, t);
}
void main() {
  vec3 p;
  vec3 n;
  clipAt(iClipA, p, n);
  if (iClipB.w > 0.0) {
    vec3 pb;
    vec3 nb;
    clipAt(iClipB, pb, nb);
    p = mix(p, pb, iClipB.w);
    n = mix(n, nb, iClipB.w);
  }
  // The mesh faces +Z with its left hand on +X and Y up. Here forward is the heading on the ground
  // plane, up is world z, and left is forward turned the way the camera's own left is (see makeCam:
  // screen right for a forward of (sin h, -cos h) is (cos h, sin h)).
  vec3 F = vec3(cos(iClipA.w), sin(iClipA.w), 0.0);
  vec3 L = vec3(F.y, -F.x, 0.0);
  vec3 w = iPos.xyz + (F * p.z + L * p.x + vec3(0.0, 0.0, p.y)) * iPos.w;
  vN = F * n.z + L * n.x + vec3(0.0, 0.0, n.y);
  // The normal in camera space, whose z is straight ahead, for the rim light.
  vNv = mat3(uView) * vN;
  vRest = aRest;
  int m = int(aMat + 0.5);
  vMat = m;
  // The garment's material, three bits apiece for coat, trousers and shoes. Skin and hair are 0.
  int pk = int(iMats + 0.5);
  vMk = m == 1 ? pk & 7 : m == 2 ? (pk >> 3) & 7 : m == 3 ? (pk >> 6) & 7 : 0;
  // For the reflections: the normal in the mesh's own frame (to pick a weave's plane), the position
  // in metres (the weave's bump is in metres), and the way back to the eye. The view matrix is a
  // rotation and a translation, so the eye is minus the translation turned back.
  vNm = n;
  vW = w / iPos.w;
  vWT = w;
  vToEye = -transpose(mat3(uView)) * uView[3].xyz - w;
  vColor = m == 0 ? iSkin : m == 1 ? iCoat : m == 2 ? iLegs : m == 3 ? iShoe
         : m == 4 ? iHair : m == 5 ? vec3(0.035) : iSkin * vec3(0.78, 0.55, 0.55);
  vLum = iLit.x;
  vAlpha = iLit.y;
  vec4 clip = uViewProj * vec4(w, 1.0);
  gl_Position = clip;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;

const FRAG = linearOut(`#version 300 es
precision highp float;
in vec3 vColor;
in vec3 vN;
in vec3 vNv;
in vec3 vRest;
flat in int vMat;
flat in int vMk;
in vec3 vNm;
in vec3 vW;
in vec3 vWT;
in vec3 vToEye;
in float vFog;
in float vAlpha;
in float vLum;
uniform vec3 uFog;
uniform vec3 uKeyDir;
uniform float uLook;
uniform float uMat;
uniform float uTop;
// The city's lights (world.js pickLights), in the tile frame vWT is in. 0 lights: nothing added.
uniform int uWLN;
// The wall's night dim (world.js nightDim). The figure's own vLum floors at 0.62, the walls go to
// 1 - nightDark; this brings a figure in an unlit lot down to the wall beside them. 1 is off.
uniform float uDim;
uniform vec3 uWLP[12];
uniform vec3 uWLC[12];
uniform float uWLR[12];
out vec4 outColor;
float h1(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h1(i), h1(i + vec3(1, 0, 0)), f.x), mix(h1(i + vec3(0, 1, 0)), h1(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h1(i + vec3(0, 0, 1)), h1(i + vec3(1, 0, 1)), f.x), mix(h1(i + vec3(0, 1, 1)), h1(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float line(float x, float w) { return 1.0 - smoothstep(0.0, w, abs(x)); }
float sq(float x) { return x * x; }
// What a shiny garment sees, with no environment map: ground below, sky above (the colours the
// ambient light already uses), a bright band where they meet, the key as a soft box, and at night a
// band of the city's lights on the horizon. Rougher blurs the lot. World z is up.
vec3 envAt(vec3 R, float rough, vec3 keyC, float nightK) {
  float w = mix(0.05, 0.5, rough);
  vec3 sky = vec3(0.46, 0.5, 0.58), gnd = vec3(0.34, 0.29, 0.24);
  vec3 c = mix(gnd * 0.6, sky * 1.1, smoothstep(-w, w, R.z));
  c += mix(sky, keyC, 0.5) * 0.45 * exp(-sq(R.z / (w + 0.06)));
  c += mix(keyC, vec3(0.2, 0.3, 0.45), 0.5) * nightK * 0.9 * exp(-sq((R.z - 0.05) / (w + 0.12)));
  float kd = max(dot(R, uKeyDir), 0.0);
  return c + keyC * (pow(kd, mix(90.0, 5.0, rough)) * mix(5.0, 0.8, rough) + 0.8 * kd * kd);
}
// Distance to a diamond lattice s metres across, in 0..0.5 of a cell.
float diamond(vec2 p, float s) {
  vec2 g = abs(fract(vec2(p.x + p.y, p.x - p.y) / s) - 0.5);
  return min(g.x, g.y);
}
// Bump from a height field by screen derivatives. p and h are both in metres.
vec3 bump(vec3 n, vec3 p, float h) {
  vec3 dx = dFdx(p), dy = dFdy(p);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 r1 = cross(dy, n), r2 = cross(n, dx);
  float det = dot(dx, r1);
  vec3 g = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * n - g);
}
void main() {
  if (vAlpha <= 0.002) discard;
  vec3 n = normalize(vN);
  vec3 col = vColor;
  float lit = clamp(0.5 + dot(n, uKeyDir) * 0.5, 0.0, 1.0);
  float up = max(n.z, 0.0);
  float k = 0.52 + 0.48 * (lit * (1.0 - up) + 0.86 * up);
  vec3 c = col * k;
  if (uLook > 0.5) {
    // Detail hung on the rest shape (mesh space, y up), so it rides the cloth. The seed is the
    // outfit colour itself: the same person keeps the same pattern, and it says nothing new.
    vec3 r = vRest;
    int m = vMat;
    float seed = dot(vColor, vec3(91.7, 37.3, 13.1));
    float grime = vnoise(r * 18.0 + seed) * 0.6 + vnoise(r * 55.0 + seed) * 0.4;
    bool skinLike = m == 0 || m == 6;
    if (m == 1) {
      float front = step(0.0, r.z);
      col *= 1.0 - 0.45 * line(r.x, 0.006) * front;
      col *= 1.0 - 0.35 * line(r.y - 0.88, 0.004) * step(0.05, abs(r.x)) * step(abs(r.x), 0.15) * front;
      float btn = line(r.x - 0.02, 0.01) * line(fract(r.y * 9.0) - 0.5, 0.08) * front * step(0.9, r.y) * step(r.y, 1.35);
      col = mix(col, vec3(0.08), btn * 0.8);
      if (fract(seed * 3.1) > 0.82) col *= 0.9 + 0.1 * step(0.5, fract(r.y * 14.0)) + 0.06 * step(0.5, fract(r.x * 14.0));
      col = mix(col, col * vec3(0.62, 0.55, 0.45), (1.0 - smoothstep(0.55, 1.0, r.y)) * grime * 0.8);
    } else if (m == 2) {
      if (fract(seed * 7.3) > 0.8) col *= 0.88 + 0.12 * step(0.5, fract(r.y * 40.0));
      col = mix(col, col * 1.25 + 0.03, line(r.y - 0.5, 0.06) * step(0.0, r.z) * grime * 0.6);
      col = mix(col, vec3(0.2, 0.17, 0.13), (1.0 - smoothstep(0.03, 0.18, r.y)) * grime * 0.6);
    } else if (m == 3) {
      col = mix(col, vec3(0.1, 0.09, 0.08), 1.0 - smoothstep(0.018, 0.028, r.y));
    } else if (skinLike) {
      col *= 0.94 + 0.08 * vnoise(r * 90.0);
    }
    // The garment's material: 0 cloth, 1 satin, 2 leather, 3 vinyl, 4 metal (ACTOR_MATERIAL). Its
    // surface detail is a bump in metres, faded out before it's smaller than a pixel, where it
    // would only glitter.
    int mk = uMat > 0.5 ? vMk : 0;
    if (mk > 0) {
      float fw = length(fwidth(r));
      float h = 0.0;
      vec2 p2 = abs(vNm.x) > abs(vNm.z) ? vec2(r.z, r.y) : vec2(r.x, r.y);
      if (mk == 4) {
        // Lame: a quilted diamond lattice, sunk at the lines and puffed in the cells.
        float d = diamond(p2, 0.008);
        h = (0.00012 * smoothstep(0.0, 0.25, d) - 0.00014 * (1.0 - smoothstep(0.0, 0.06, d))) * (1.0 - smoothstep(0.00064, 0.002, fw));
      } else if (mk == 2) {
        // Leather: grain, and the odd crease where it bends.
        h = (0.0003 * vnoise(r * 700.0) * (1.0 - smoothstep(0.0005, 0.0015, fw))) + 0.0008 * smoothstep(0.7, 0.9, vnoise(r * 40.0 + seed));
      } else if (mk == 1) {
        h = 0.0002 * sin(p2.y * 900.0 + vnoise(r * 30.0) * 6.0) * (1.0 - smoothstep(0.0003, 0.001, fw));
      }
      n = bump(n, vW, h);
    }
    // Wrap key, sky over warm ground, fake occlusion, a rim off the camera and a little sheen on
    // skin. How dark the night is comes from the figure's own dimming, so the billboard still matches.
    float night = clamp(1.0 - vLum, 0.0, 1.0);
    float wrap = max(0.0, (dot(n, uKeyDir) + 0.35) / 1.35);
    vec3 amb = mix(vec3(0.34, 0.29, 0.24), vec3(0.46, 0.5, 0.58), n.z * 0.5 + 0.5);
    vec3 keyC = mix(vec3(0.62, 0.58, 0.52), vec3(0.6, 0.48, 0.34), night);
    float ao = mix(0.6, 1.0, smoothstep(0.0, 0.3, r.y));
    ao *= 1.0 - 0.3 * line(r.y - 0.93, 0.08) * (1.0 - smoothstep(0.03, 0.09, abs(r.x)));
    ao *= 1.0 - 0.25 * step(abs(r.x), 0.24) * step(0.18, abs(r.x)) * line(r.y - uTop * 0.75, 0.1);
    float rim = pow(1.0 - abs(normalize(vNv).z), 3.0);
    vec3 rimC = mix(vec3(0.12, 0.13, 0.15), vec3(0.2, 0.3, 0.45), night);
    c = col * (amb * ao + keyC * wrap) + rim * rimC;
    if (skinLike) c += keyC * pow(max(dot(n, normalize(uKeyDir + vec3(0.0, 0.0, 1.0))), 0.0), 24.0) * 0.1;
    if (mk > 0) {
      vec3 v = normalize(vToEye);
      float ndv = max(dot(n, v), 0.0);
      float fr = pow(1.0 - ndv, 5.0);
      float mr = mk == 1 ? 0.42 : mk == 2 ? 0.55 : mk == 3 ? 0.1 : 0.36;
      // vLum bottoms out at 0.62 at night, so night itself only reaches 0.38.
      vec3 E = envAt(reflect(-v, n), mr, keyC, clamp(night / 0.38, 0.0, 1.0)) * ao;
      if (mk == 4) {
        // Metal has next to no diffuse: its colour is the colour of what it reflects.
        c = col * amb * ao * 0.15 + mix(col, vec3(1.0), fr * 0.5) * E + rim * rimC * 0.3;
      } else {
        // Satin's sheen takes the fibre's colour and brightens where the cloth turns away;
        // leather and vinyl reflect white, vinyl hard.
        float kr = mk == 1 ? mix(0.06, 0.5, fr) + 0.12 * sq(1.0 - ndv) : mk == 2 ? mix(0.035, 0.3, fr) : mix(0.05, 0.8, fr);
        vec3 tint = mk == 1 ? mix(vec3(1.0), col / max(0.05, max(col.r, max(col.g, col.b))), 0.7) : vec3(1.0);
        c = c * (1.0 - kr) + tint * E * kr * (mk == 3 ? 1.6 : 1.0);
      }
    }
  }
  c *= vLum;
  c *= min(1.0, uDim / mix(1.0, 0.62, clamp((1.0 - vLum) / 0.38, 0.0, 1.0)));
  // ── THE STREETLIGHT ON THEM ──────────────────────────────────────────────
  // A figure under a lamp takes its colour on the side facing it, coloured by what they wear, so
  // somebody walking past a sign at night is lit by it and dark again beyond it.
  for (int i = 0; i < 12; i++) {
    if (i >= uWLN) break;
    vec3 d = uWLP[i] - vWT;
    float dist = length(d);
    float att = clamp(1.0 - dist / max(0.001, uWLR[i]), 0.0, 1.0);
    if (att <= 0.0) continue;
    float diff = max(0.0, (dot(n, d / max(0.001, dist)) + 0.4) / 1.4);
    c += col * uWLC[i] * (att * att * diff * 1.6);
  }
  // A figure is paint, not light, and the bloom takes anything over 1 for an emitter (HDR_TUNE in
  // world.js), so an orange coat under a warm lamp glowed like a sign. Scaled down rather than
  // clamped per channel, so the coat stays orange instead of going yellow.
  c /= max(1.0, max(c.r, max(c.g, c.b)));
  c = mix(c, uFog, vFog);
  outColor = vec4(c * vAlpha, vAlpha);
}`, 'outColor');

// ── THE HEAD ────────────────────────────────────────────────────────────────────────────────────────
// Per instance: x, y, z, tiles per metre | clip A row0, frames, phase, heading | clip B row0, frames,
// phase, share of B | skin rgb | hair rgb | lips rgb | lipstick rgb | iris rgb | brightness, alpha,
// layout + 32 · hair style, makeup. The clips are the body's, so the head is where the body has it.
const HSTRIDE = 31;
// Units nothing else binds: the body has 20 and 21, cloth 24 and 25.
const BONE_UNIT = 22, FACE_UNIT = 23;
const f4 = (v) => v.toFixed(4);

const HEAD_VERT = `#version 300 es
precision highp float;
precision highp int;
in vec3 aP;
in vec3 aN;
// The feature (7 skin, 8 ears, 9 hair, 12 neck), how much the vertex rides the head rather than the
// neck, and an ear's hollow.
in vec3 aFW;
in vec4 iPos;
in vec4 iClipA;
in vec4 iClipB;
in vec3 iSkin;
in vec3 iHair;
in vec3 iLip;
in vec3 iLipstick;
in vec3 iIris;
in vec4 iFace;
uniform highp sampler2D uBones;
uniform mat4 uViewProj;
uniform mat4 uView;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
out vec3 vN;
out vec3 vNv;
out vec3 vRest;
out vec3 vWT;
out vec3 vToEye;
flat out vec3 vSkin;
flat out vec3 vHair;
flat out vec3 vLip;
flat out vec3 vLipstick;
flat out vec3 vIris;
// The ear's hollow on an ear, how much of the face texture applies on the skull; the fog; the
// brightness; the alpha.
out vec4 vMisc;
// The layout, the makeup, the hair style and the feature.
flat out vec4 vFace;
// A bone's matrix on one baked row: three texels, its rows [m00 m01 m02 tx] and so on.
mat4 boneOf(int row, int at) {
  vec4 r0 = texelFetch(uBones, ivec2(at, row), 0);
  vec4 r1 = texelFetch(uBones, ivec2(at + 1, row), 0);
  vec4 r2 = texelFetch(uBones, ivec2(at + 2, row), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
// The two frames either side of a clip's phase, blended: the body's clipAt, for a bone.
mat4 boneAt(vec4 c, int at) {
  float fr = fract(c.z) * c.y;
  int f0 = int(fr);
  int f1 = f0 + 1;
  if (float(f1) >= c.y) f1 = 0;
  float t = fr - float(f0);
  int b = int(c.x + 0.5);
  return boneOf(b + f0, at) * (1.0 - t) + boneOf(b + f1, at) * t;
}
void main() {
  mat4 MH = boneAt(iClipA, ${ACTOR_HEAD_BONES.head});
  mat4 MN = boneAt(iClipA, ${ACTOR_HEAD_BONES.neck});
  if (iClipB.w > 0.0) {
    MH = MH * (1.0 - iClipB.w) + boneAt(iClipB, ${ACTOR_HEAD_BONES.head}) * iClipB.w;
    MN = MN * (1.0 - iClipB.w) + boneAt(iClipB, ${ACTOR_HEAD_BONES.neck}) * iClipB.w;
  }
  vec3 p = mix((MN * vec4(aP, 1.0)).xyz, (MH * vec4(aP, 1.0)).xyz, aFW.y);
  vec3 n = normalize(mix(mat3(MN) * aN, mat3(MH) * aN, aFW.y));
  // Onto the ground plane exactly as the body's VERT does it.
  vec3 F = vec3(cos(iClipA.w), sin(iClipA.w), 0.0);
  vec3 L = vec3(F.y, -F.x, 0.0);
  vec3 w = iPos.xyz + (F * p.z + L * p.x + vec3(0.0, 0.0, p.y)) * iPos.w;
  vN = F * n.z + L * n.x + vec3(0.0, 0.0, n.y);
  vNv = mat3(uView) * vN;
  vRest = aP;
  vWT = w;
  vToEye = -transpose(mat3(uView)) * uView[3].xyz - w;
  vSkin = iSkin; vHair = iHair; vLip = iLip; vLipstick = iLipstick; vIris = iIris;
  int f = int(aFW.x + 0.5);
  float sel = f == 8 ? aFW.z : f == 7 ? smoothstep(0.1, 0.4, aN.z) : 0.0;
  float code = iFace.z;
  vFace = vec4(mod(code, 32.0), iFace.w, floor(code / 32.0 + 0.001), aFW.x);
  vec4 clip = uViewProj * vec4(w, 1.0);
  gl_Position = clip;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vMisc = vec4(sel, ff * ff * uFogAmt, iFace.x, iFace.y);
}`;

// The lab's head shading (tools/modelshop/actor-head.js HEAD_FRAG) on the atlas, lit the way the body
// is lit here so the head isn't pasted on: the same key, sky over ground, rim, night dim, city lights
// and fog. Strand and hairline detail fade out before it's under a pixel, where it would only crawl.
const HEAD_FRAG = linearOut(`#version 300 es
precision highp float;
precision highp int;
in vec3 vN;
in vec3 vNv;
in vec3 vRest;
in vec3 vWT;
in vec3 vToEye;
flat in vec3 vSkin;
flat in vec3 vHair;
flat in vec3 vLip;
flat in vec3 vLipstick;
flat in vec3 vIris;
in vec4 vMisc;
flat in vec4 vFace;
uniform sampler2D uAtlas;
uniform vec3 uFog;
uniform vec3 uKeyDir;
uniform float uDim;
uniform int uWLN;
uniform vec3 uWLP[12];
uniform vec3 uWLC[12];
uniform float uWLR[12];
out vec4 outColor;
float h1(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h1(i), h1(i + vec3(1, 0, 0)), f.x), mix(h1(i + vec3(0, 1, 0)), h1(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h1(i + vec3(0, 0, 1)), h1(i + vec3(1, 0, 1)), f.x), mix(h1(i + vec3(0, 1, 1)), h1(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float sq(float x) { return x * x; }
${FACE_GLSL}
${HAIRLINE_GLSL}
// The hair's colour at a point, for the shell and the scalp under its edge alike. 'fine' is 1 up
// close and 0 once a strand is smaller than a pixel.
vec3 hairAt(vec3 r, float psi, int style, float seed, float fine) {
  float strand = style == 4
    ? vnoise(vec3(r.x * 320.0, r.y * 60.0 - r.z * 20.0, seed))
    : vnoise(vec3(psi * 40.0, r.y * 14.0, seed)) * 0.6 + vnoise(vec3(psi * 110.0, r.y * 30.0, seed + 7.0)) * 0.4;
  if (style == 3 && r.y < 1.62) strand = vnoise(vec3(atan(r.x, -r.z) * 60.0, r.y * 6.0, seed));
  return vHair * (0.68 + 0.6 * mix(0.5, strand, fine));
}
void main() {
  float alpha = vMisc.w;
  if (alpha <= 0.002) discard;
  vec3 r = vRest;
  vec3 n = normalize(vN);
  vec3 v = normalize(vToEye);
  int f = int(vFace.w + 0.5), style = int(vFace.z + 0.5);
  bool hair = f == 9;
  // The long hair's sheet is one-sided: seen from inside, it faces the eye.
  if (hair && dot(n, v) < 0.0) n = -n;
  float seed = vFace.x * 7.31 + dot(vHair, vec3(91.7, 37.3, 13.1));
  float fine = 1.0 - smoothstep(0.0015, 0.005, length(fwidth(r)));
  float psi = atan(abs(r.x), r.z + 0.006);
  // The face's texel, fetched on every path so its mip level comes from smooth derivatives.
  float lay = vFace.x;
  vec4 cell = vec4(mod(lay, ${FACE_ATLAS.cols}.0) / ${FACE_ATLAS.cols}.0, (${FACE_ATLAS.rows - 1}.0 - floor(lay / ${FACE_ATLAS.cols}.0 + 0.001)) / ${FACE_ATLAS.rows}.0,
    1.0 / ${FACE_ATLAS.cols}.0, 1.0 / ${FACE_ATLAS.rows}.0);
  vec2 uv = clamp((r.xy - vec2(${f4(FACE.x0)}, ${f4(FACE.y0)})) / vec2(${f4(FACE.x1 - FACE.x0)}, ${f4(FACE.y1 - FACE.y0)}), 0.0, 1.0);
  vec4 m = texture(uAtlas, cell.xy + uv * cell.zw);
  vec3 col = vSkin;
  float spec = 0.0, ao = 1.0;
  if (hair) {
    float hl = hairlineAt(r);
    col = hairAt(r, psi, style, seed, fine);
    if (style == 1) col *= 1.0 - 0.5 * fine * (1.0 - smoothstep(0.0, 0.0012, abs(r.x - 0.024))) * smoothstep(1.7, 1.72, r.y) * smoothstep(-0.03, 0.02, r.z);
    // Where the shell thins to its edge the scalp shows through; cut sides are mostly skin.
    ao = mix(0.85, 1.0, smoothstep(hl + 0.004, hl + 0.016, r.y));
    if (style == 4) {
      float cut = smoothstep(0.04, 0.05, abs(r.x)) * (1.0 - smoothstep(1.708, 1.722, r.y));
      col = mix(col, mix(vSkin, vHair * 0.5, 0.5 + 0.3 * mix(0.5, vnoise(r * 900.0), fine)), cut);
    }
  } else {
    float wt = vMisc.x;
    if (f == 7) {
      float wet;
      vec3 fc = faceColour(m, r, vSkin, vHair, vLip, vLipstick, vFace.y, vIris, wet);
      col = mix(vSkin, fc, wt);
      spec = wet * 2.0 * wt;
      // The scalp under the hair, with a soft broken edge for a hairline.
      float hl = hairlineAt(r);
      float jit = 0.0026 * fine * (vnoise(vec3(psi * 70.0, r.y * 400.0, seed)) - 0.5);
      float sc = smoothstep(hl - 0.0025, hl + 0.0025, r.y + jit);
      col = mix(col, hairAt(r, psi, style, seed, fine) * 0.95, sc);
      ao = mix(ao, 0.88, sc);
      col *= 1.0 - 0.18 * smoothstep(1.534, 1.522, r.y);
    } else if (f == 8) {
      col = vSkin * vec3(1.03, 0.94, 0.92) * (1.0 - 0.3 * vMisc.x);
      ao = 1.0 - 0.3 * vMisc.x;
    } else {
      // The neck, with the jaw's shadow on the throat.
      float under = smoothstep(1.49, 1.535, r.y) * smoothstep(-0.02, 0.025, r.z);
      col = vSkin * (1.0 - 0.3 * under);
      ao = 1.0 - 0.25 * under;
    }
  }
  // The body's light (FRAG): wrap key, sky over warm ground, a rim off the camera.
  float lum = vMisc.z;
  float night = clamp(1.0 - lum, 0.0, 1.0);
  float nk = dot(n, uKeyDir);
  float wrap = max(0.0, (nk + 0.35) / 1.35);
  vec3 amb = mix(vec3(0.34, 0.29, 0.24), vec3(0.46, 0.5, 0.58), n.z * 0.5 + 0.5);
  vec3 keyC = mix(vec3(0.62, 0.58, 0.52), vec3(0.6, 0.48, 0.34), night);
  float rim = pow(1.0 - abs(normalize(vNv).z), 3.0);
  vec3 rimC = mix(vec3(0.12, 0.13, 0.15), vec3(0.2, 0.3, 0.45), night);
  vec3 c = col * (amb * ao + keyC * wrap) + rim * rimC;
  float nh = max(dot(n, normalize(uKeyDir + v)), 0.0);
  if (!hair) {
    // Light that gets under the skin warms the edge of the shadow; the eyes and lips are wet.
    c += col * vec3(0.3, 0.1, 0.06) * keyC * (smoothstep(-0.45, 0.1, nk) - smoothstep(0.1, 0.7, nk)) * 0.8;
    c += keyC * (pow(nh, 28.0) * 0.07 + pow(nh, 120.0) * spec * 1.2);
  } else {
    c += keyC * 0.12 * exp(-sq((nh - 0.72) / 0.12)) * (0.4 + dot(vHair, vec3(0.33))) * (style == 1 || style == 4 ? 1.8 : 1.0);
    c += keyC * pow(nh, 40.0) * 0.03;
  }
  c *= lum;
  c *= min(1.0, uDim / mix(1.0, 0.62, clamp((1.0 - lum) / 0.38, 0.0, 1.0)));
  for (int i = 0; i < 12; i++) {
    if (i >= uWLN) break;
    vec3 d = uWLP[i] - vWT;
    float dist = length(d);
    float att = clamp(1.0 - dist / max(0.001, uWLR[i]), 0.0, 1.0);
    if (att <= 0.0) continue;
    float diff = max(0.0, (dot(n, d / max(0.001, dist)) + 0.4) / 1.4);
    c += col * uWLC[i] * (att * att * diff * 1.6);
  }
  // Paint, not light: see the same line in FRAG.
  c /= max(1.0, max(c.r, max(c.g, c.b)));
  c = mix(c, uFog, vMisc.y);
  outColor = vec4(c * alpha, alpha);
}`, 'outColor');

// The face atlas, loaded once for every context. A phone-class screen (GL_TIER's test in
// windshield.js, which this can't import) takes the half-size copy, whose cells sit on 32-texel
// boundaries, so it stops a mip sooner.
const HALF_ATLAS = (() => {
  try {
    const mm = globalThis.matchMedia, sc = globalThis.screen;
    if (typeof mm !== 'function' || !sc) return false;
    if (globalThis.localStorage?.getItem('architect_gl_tier') === 'full') return false;
    const shortSide = Math.min(sc.width || 0, sc.height || 0);
    return mm('(pointer: coarse)').matches && shortSide > 0 && shortSide < 600;
  } catch { return false; }
})();
let ATLAS_IMG = null;
function atlasImage() {
  if (ATLAS_IMG || typeof Image !== 'function') return ATLAS_IMG;
  try {
    ATLAS_IMG = new Image();
    ATLAS_IMG.decoding = 'async';
    ATLAS_IMG.src = new URL('../../../' + (HALF_ATLAS ? FACE_ATLAS.half : FACE_ATLAS.src), import.meta.url).href;
  } catch { ATLAS_IMG = null; }
  return ATLAS_IMG;
}

function compile(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('actors ' + label + ': ' + gl.getShaderInfoLog(s));
  return s;
}

export function createActorLayer(gl) {
  // Prewarmed with the context when it can be (programs.js); built here otherwise.
  let prog = takeWarm(gl, VERT, FRAG);
  if (!prog) {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
    gl.linkProgram(prog);
  }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('actors link: ' + gl.getProgramInfoLog(prog));
  const A = (n) => gl.getAttribLocation(prog, n);
  const loc = {
    mat: A('aMat'), pos: A('iPos'), clipA: A('iClipA'), clipB: A('iClipB'),
    coat: A('iCoat'), legs: A('iLegs'), skin: A('iSkin'), hair: A('iHair'), shoe: A('iShoe'), lit: A('iLit'), mats: A('iMats'),
    posT: gl.getUniformLocation(prog, 'uPosT'),
    nrmT: gl.getUniformLocation(prog, 'uNrmT'),
    w: gl.getUniformLocation(prog, 'uW'),
    rows: gl.getUniformLocation(prog, 'uRows'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
    keyDir: gl.getUniformLocation(prog, 'uKeyDir'),
    view: gl.getUniformLocation(prog, 'uView'),
    look: gl.getUniformLocation(prog, 'uLook'),
    matOn: gl.getUniformLocation(prog, 'uMat'),
    top: gl.getUniformLocation(prog, 'uTop'),
    rest: A('aRest'),
    dim: gl.getUniformLocation(prog, 'uDim'),
    wlN: gl.getUniformLocation(prog, 'uWLN'), wlP: gl.getUniformLocation(prog, 'uWLP'),
    wlC: gl.getUniformLocation(prog, 'uWLC'), wlR: gl.getUniformLocation(prog, 'uWLR'),
  };
  const wlP = new Float32Array(36), wlC = new Float32Array(36), wlR = new Float32Array(12);

  // ── The head's program, meshes and textures ─────────────────────────────────────────────────────
  let hprog = takeWarm(gl, HEAD_VERT, HEAD_FRAG);
  if (!hprog) {
    hprog = gl.createProgram();
    gl.attachShader(hprog, compile(gl, gl.VERTEX_SHADER, HEAD_VERT, 'head vertex'));
    gl.attachShader(hprog, compile(gl, gl.FRAGMENT_SHADER, HEAD_FRAG, 'head fragment'));
    gl.linkProgram(hprog);
  }
  if (!gl.getProgramParameter(hprog, gl.LINK_STATUS)) throw new Error('actors head link: ' + gl.getProgramInfoLog(hprog));
  const HA = (nm) => gl.getAttribLocation(hprog, nm), HU = (nm) => gl.getUniformLocation(hprog, nm);
  const hloc = {
    p: HA('aP'), n: HA('aN'), fw: HA('aFW'),
    bones: HU('uBones'), atlas: HU('uAtlas'), viewProj: HU('uViewProj'), view: HU('uView'),
    fog: HU('uFog'), fogNear: HU('uFogNear'), fogFar: HU('uFogFar'), fogAmt: HU('uFogAmt'),
    keyDir: HU('uKeyDir'), dim: HU('uDim'),
    wlN: HU('uWLN'), wlP: HU('uWLP'), wlC: HU('uWLC'), wlR: HU('uWLR'),
  };
  // Where each instance attribute sits in a record, in floats. Re-pointed per draw at the draw's
  // first instance, since WebGL2 has no base instance.
  const HINST = [
    [HA('iPos'), 4, 0], [HA('iClipA'), 4, 4], [HA('iClipB'), 4, 8], [HA('iSkin'), 3, 12], [HA('iHair'), 3, 15],
    [HA('iLip'), 3, 18], [HA('iLipstick'), 3, 21], [HA('iIris'), 3, 24], [HA('iFace'), 4, 27],
  ].filter(([l]) => l >= 0);
  const hstream = makeVertexStream(gl, gl.createVertexArray(), HSTRIDE, [], HSTRIDE * 64);
  // A VAO per mesh: its own vertices and indices, and the instance attributes on the shared stream.
  function headVao(m) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = (data, l, k) => {
      if (l < 0) return;
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, k, gl.FLOAT, false, k * 4, 0);
    };
    const nv = m.P.length / 3, fw = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { fw[i * 3] = m.F[i]; fw[i * 3 + 1] = m.W[i]; fw[i * 3 + 2] = m.X[i]; }
    buf(m.P, hloc.p, 3); buf(m.N, hloc.n, 3); buf(fw, hloc.fw, 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, hstream.buf);
    for (const [l] of HINST) { gl.enableVertexAttribArray(l); gl.vertexAttribDivisor(l, 1); }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.I, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: m.I.length };
  }
  // Built the first time a level is drawn: a skull (skin, ears, neck) and a shell per hair style.
  const headMeshes = [];
  const meshesAt = (lv) => headMeshes[lv] || (headMeshes[lv] = {
    skull: headVao(headMesh(lv)), hair: Array.from({ length: HAIR_STYLES }, (_, s) => headVao(hairMesh(s, lv))),
  });
  // The bones, a row a baked frame (ACTOR_HEAD_BONES), and the atlas. Until the atlas has loaded the
  // face is a one-texel stand-in that reads as plain skin: shade 1 (R × 1.5), no hair, lips or eyes.
  let boneT = null, faceT = null, atlasDone = false;
  function texture2D(unit) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function bonesFor(bk) {
    if (boneT) return boneT;
    boneT = texture2D(BONE_UNIT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ACTOR_HEAD_BONES.texels, bk.frames, 0, gl.RGBA, gl.FLOAT, bk.bones);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return boneT;
  }
  function faceTex() {
    if (!faceT) {
      faceT = texture2D(FACE_UNIT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([170, 0, 0, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    const img = atlasDone ? null : atlasImage();
    if (img && img.complete && img.naturalWidth > 0) {
      atlasDone = true;
      // ⚠ FLIPPED, NOT PREMULTIPLIED AND NOT COLOUR-CONVERTED: the four channels are masks, and
      // either of the last two would mix them (actor-faces.js). All three go back after.
      try {
        gl.activeTexture(gl.TEXTURE0 + FACE_UNIT);
        gl.bindTexture(gl.TEXTURE_2D, faceT);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, FACE_ATLAS.maxLevel - (HALF_ATLAS ? 1 : 0));
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      } catch { /* the stand-in stays */ }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return faceT;
  }
  // This frame's heads, sorted by level then hair style; `hc` counts each (level, style) bucket.
  const NB = HEAD_LEVELS.length * HAIR_STYLES;
  const hc = new Int32Array(NB), hat = new Int32Array(NB + 1);
  let hdata = new Float32Array(HSTRIDE * 64), nh = 0;
  const hb = (r) => Math.max(0, Math.min(HEAD_LEVELS.length - 1, r.hl | 0)) * HAIR_STYLES + ((r.o.face && r.o.face.hairStyle) | 0);

  // Each body's mesh and textures go up once, the first time anybody is drawn with it. Index 0 is the
  // close-up body and 1 the far one (actor3d.js bk.far); both play through the one program, and both
  // use units 20 and 21, bound in turn at draw time.
  const meshes = [null, null];
  function meshFor(bk, lod) {
    if (meshes[lod]) return meshes[lod];
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const mb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mb);
    gl.bufferData(gl.ARRAY_BUFFER, bk.mat, gl.STATIC_DRAW);
    if (loc.mat >= 0) { gl.enableVertexAttribArray(loc.mat); gl.vertexAttribPointer(loc.mat, 1, gl.FLOAT, false, 4, 0); }
    // The rest shape: the idle clip's first frame, a static coordinate the fragment shader hangs
    // seams and grime on. A body without a preview gets a constant, which leaves the detail inert.
    if (loc.rest >= 0) {
      const i0 = bk.clips.idle.row0 * bk.nv * 3;
      if (bk.preview && bk.preview.length >= i0 + bk.nv * 3) {
        const rb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, rb);
        gl.bufferData(gl.ARRAY_BUFFER, bk.preview.slice(i0, i0 + bk.nv * 3), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc.rest);
        gl.vertexAttribPointer(loc.rest, 3, gl.FLOAT, false, 12, 0);
      } else {
        gl.disableVertexAttribArray(loc.rest);
        gl.vertexAttrib3f(loc.rest, 0, 1, 0);
      }
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bk.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const at = (l, n, off) => [l, n, off * 4];
    const stream = makeVertexStream(gl, vao, STRIDE, [
      at(loc.pos, 4, 0), at(loc.clipA, 4, 4), at(loc.clipB, 4, 8), at(loc.coat, 3, 12), at(loc.legs, 3, 15),
      at(loc.skin, 3, 18), at(loc.hair, 3, 21), at(loc.shoe, 3, 24), at(loc.lit, 2, 27), at(loc.mats, 1, 29),
    ], STRIDE * 64);
    // One advance per instance, not per vertex. The divisor is VAO state, so it is set once, here.
    gl.bindVertexArray(vao);
    for (const l of [loc.pos, loc.clipA, loc.clipB, loc.coat, loc.legs, loc.skin, loc.hair, loc.shoe, loc.lit, loc.mats]) if (l >= 0) gl.vertexAttribDivisor(l, 1);
    gl.bindVertexArray(null);
    const tex = (unit, data) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, bk.W, bk.H, 0, gl.RGBA, gl.HALF_FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      return t;
    };
    meshes[lod] = { vao, stream, count: bk.idx.length, posT: tex(POS_UNIT, bk.pos), nrmT: tex(NRM_UNIT, bk.nrm), bk,
      data: new Float32Array(STRIDE * 64), n: 0 };
    return meshes[lod];
  }

  let n = 0;
  let key = [-0.7, -0.7, 0.35];

  /**
   * Take this frame's records. Each is { x, y, z, s, hd, clip, ph, clip2, ph2, mix, o, lum, a, lx, ly }:
   * map-window tiles, tiles per metre, heading in radians on the ground plane, the clip and its phase
   * (and optionally a second clip being blended from), the outfit, brightness, alpha, and the frame's
   * key-light direction on the ground plane. `lod: 1` draws the far body.
   */
  function upload(recs) {
    n = 0; nh = 0;
    for (const M of meshes) if (M) M.n = 0;
    const bake = actorBakeReady();
    if (!bake || !recs || !recs.length) return 0;
    uploadHeads(recs, bake);
    for (const r of recs) if (r.lod && bake.far) meshFor(bake.far, 1).n++; else meshFor(bake, 0).n++;
    for (const M of meshes) {
      if (!M || !M.n) continue;
      if (M.data.length < M.n * STRIDE) M.data = new Float32Array(Math.max(M.n * STRIDE, M.data.length * 2));
      M.n = 0;
    }
    for (const r of recs) {
      const M = r.lod && bake.far ? meshes[1] : meshes[0], bk = M.bk, data = M.data;
      const c = (o, rgb) => { data[o] = rgb[0] / 255; data[o + 1] = rgb[1] / 255; data[o + 2] = rgb[2] / 255; };
      const A = bk.clips[r.clip] || bk.clips.idle, Bc = r.clip2 ? bk.clips[r.clip2] : null;
      const o = M.n * STRIDE;
      data[o] = r.x; data[o + 1] = r.y; data[o + 2] = r.z || 0; data[o + 3] = r.s;
      data[o + 4] = A.row0; data[o + 5] = A.len; data[o + 6] = r.ph || 0; data[o + 7] = r.hd || 0;
      data[o + 8] = Bc ? Bc.row0 : 0; data[o + 9] = Bc ? Bc.len : 1; data[o + 10] = r.ph2 || 0; data[o + 11] = Bc ? (r.mix || 0) : 0;
      c(o + 12, r.o.coat); c(o + 15, r.o.legs); c(o + 18, r.o.skin); c(o + 21, r.o.hair); c(o + 24, r.o.shoes);
      data[o + 27] = r.lum == null ? 1 : r.lum; data[o + 28] = r.a == null ? 1 : r.a;
      const mt = r.o.mat;
      data[o + 29] = mt ? (mt[0] & 7) + (mt[1] & 7) * 8 + (mt[2] & 7) * 64 : 0;
      M.n++; n++;
    }
    const r0 = recs[0];
    const kl = Math.hypot(r0.lx || 0, r0.ly || 0, 0.35) || 1;
    key = [(r0.lx || 0) / kl, (r0.ly || 0) / kl, 0.35 / kl];
    for (const M of meshes) if (M && M.n) M.stream.write(M.data, M.n * STRIDE);
    return n;
  }

  // The near body has no head of its own, so every near record gets one here: the same position,
  // clips and phases as its body, and the face its outfit carries.
  function uploadHeads(recs, bake) {
    if (!bake.bones) return;
    hc.fill(0);
    for (const r of recs) if (!(r.lod && bake.far)) { hc[hb(r)]++; nh++; }
    if (!nh) return;
    hat[0] = 0;
    for (let i = 0; i < NB; i++) hat[i + 1] = hat[i] + hc[i];
    if (hdata.length < nh * HSTRIDE) hdata = new Float32Array(Math.max(nh * HSTRIDE, hdata.length * 2));
    hc.fill(0);
    const c = (o, rgb) => { hdata[o] = rgb[0] / 255; hdata[o + 1] = rgb[1] / 255; hdata[o + 2] = rgb[2] / 255; };
    for (const r of recs) {
      if (r.lod && bake.far) continue;
      const b = hb(r), o = (hat[b] + hc[b]++) * HSTRIDE, F = r.o.face;
      const A = bake.clips[r.clip] || bake.clips.idle, Bc = r.clip2 ? bake.clips[r.clip2] : null;
      hdata[o] = r.x; hdata[o + 1] = r.y; hdata[o + 2] = r.z || 0; hdata[o + 3] = r.s;
      hdata[o + 4] = A.row0; hdata[o + 5] = A.len; hdata[o + 6] = r.ph || 0; hdata[o + 7] = r.hd || 0;
      hdata[o + 8] = Bc ? Bc.row0 : 0; hdata[o + 9] = Bc ? Bc.len : 1; hdata[o + 10] = r.ph2 || 0; hdata[o + 11] = Bc ? (r.mix || 0) : 0;
      c(o + 12, r.o.skin); c(o + 15, r.o.hair);
      c(o + 18, F ? F.lip : r.o.skin); c(o + 21, F ? F.lipstick : r.o.skin); c(o + 24, F ? F.iris : [60, 44, 32]);
      hdata[o + 27] = r.lum == null ? 1 : r.lum; hdata[o + 28] = r.a == null ? 1 : r.a;
      hdata[o + 29] = (F ? F.layout : 0) + 32 * (b % HAIR_STYLES); hdata[o + 30] = F ? F.makeup : 0;
    }
    hstream.write(hdata, nh * HSTRIDE);
  }

  function drawHeads(bk, uniforms) {
    if (!nh || !bk.bones) return 0;
    gl.useProgram(hprog); applyLinOut(gl, hprog);
    uniforms(hloc);
    // ⚠ BOTH FETCHED BEFORE EITHER IS BOUND: each can make or upload its texture, which changes the
    // active unit and leaves nothing bound on it. Called between an activeTexture and its bind, the
    // bones went to unit 0 and the heads collapsed to a point.
    const bt = bonesFor(bk), ft = faceTex();
    gl.activeTexture(gl.TEXTURE0 + BONE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, bt);
    gl.activeTexture(gl.TEXTURE0 + FACE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, ft);
    gl.uniform1i(hloc.bones, BONE_UNIT);
    gl.uniform1i(hloc.atlas, FACE_UNIT);
    const S = HSTRIDE * 4;
    let tris = 0;
    const run = (m, first, count) => {
      gl.bindVertexArray(m.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, hstream.buf);
      for (const [l, k, off] of HINST) gl.vertexAttribPointer(l, k, gl.FLOAT, false, S, (first * HSTRIDE + off) * 4);
      gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, count);
      tris += (m.count / 3) * count;
    };
    for (let lv = 0; lv < HEAD_LEVELS.length; lv++) {
      const a = hat[lv * HAIR_STYLES], z = hat[(lv + 1) * HAIR_STYLES];
      if (z <= a) continue;
      const M = meshesAt(lv);
      run(M.skull, a, z - a);
      for (let s = 0; s < HAIR_STYLES; s++) {
        const b = lv * HAIR_STYLES + s;
        if (hat[b + 1] > hat[b]) run(M.hair[s], hat[b], hat[b + 1] - hat[b]);
      }
    }
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0 + BONE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0 + FACE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return tris;
  }

  function draw(cam, cssH, opts = {}) {
    if (!n) return 0;
    gl.useProgram(prog); applyLinOut(gl, prog);
    const VP = viewProjMatrix(cam, cssH, opts.near, opts.far), VM = viewMatrix(cam);
    const f = opts.fog;
    // Set on every draw, on or off: the mirror prepass draws people with no list.
    const WL = opts.lights || [], nW = Math.min(12, WL.length);
    for (let i = 0; i < nW; i++) { const L = WL[i]; wlP.set(L.p, i * 3); wlC.set(L.lamp || L.rgb, i * 3); wlR[i] = L.rl || (L.rw == null ? L.r : L.rw); }
    // What the body and the head share, into whichever program is in use.
    const uniforms = (U) => {
      gl.uniformMatrix4fv(U.viewProj, false, VP);
      gl.uniformMatrix4fv(U.view, false, VM);
      gl.uniform3f(U.fog, f ? f.col[0] : 0, f ? f.col[1] : 0, f ? f.col[2] : 0);
      gl.uniform1f(U.fogNear, f ? f.near : 1e9);
      gl.uniform1f(U.fogFar, f ? f.far : 1e9 + 1);
      gl.uniform1f(U.fogAmt, f ? f.amt : 0);
      gl.uniform3f(U.keyDir, key[0], key[1], key[2]);
      gl.uniform1i(U.wlN, nW);
      gl.uniform1f(U.dim, opts.nightDim > 0 ? opts.nightDim : 1);
      if (nW) { gl.uniform3fv(U.wlP, wlP); gl.uniform3fv(U.wlC, wlC); gl.uniform1fv(U.wlR, wlR); }
    };
    uniforms(loc);
    gl.uniform1f(loc.look, ACTOR_LOOK.on ? 1 : 0);
    gl.uniform1f(loc.matOn, ACTOR_LOOK.mat ? 1 : 0);
    gl.uniform1i(loc.posT, POS_UNIT);
    gl.uniform1i(loc.nrmT, NRM_UNIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let tris = 0;
    for (const mesh of meshes) {
      if (!mesh || !mesh.n) continue;
      gl.uniform1i(loc.w, mesh.bk.W);
      gl.uniform1i(loc.rows, mesh.bk.rows);
      gl.uniform1f(loc.top, mesh.bk.top || 1.7);
      gl.activeTexture(gl.TEXTURE0 + POS_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, mesh.posT);
      gl.activeTexture(gl.TEXTURE0 + NRM_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, mesh.nrmT);
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0, mesh.n);
      tris += (mesh.count / 3) * mesh.n;
    }
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0 + POS_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    if (meshes[0]) tris += drawHeads(meshes[0].bk, uniforms);
    return tris;
  }

  return {
    upload, draw,
    get instances() { return n; },
    get heads() { return nh; },
  };
}

declareProgram(VERT, FRAG);
declareProgram(HEAD_VERT, HEAD_FRAG);
