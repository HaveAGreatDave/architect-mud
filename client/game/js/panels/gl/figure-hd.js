// GLASS 2 · THE CLOSE-UP FIGURE, DRAWN. The Room Stage's people (gl/room.js) and the Figure Lab
// draw figure.js's `hd` figure with this: one indexed mesh a cut and hair style, built once and
// skinned on the GPU into whatever pose the CPU worked out (gl/room-people.js figurePeople).
//
//   · A record carries its 19 bones as rows (FIG_BONE_ROWS floats: each bone's 3×4 transform from
//     bind space straight into the room, the placing and the drop to the floor already in it), its
//     colours and materials by slot, and its face.
//   · The light is the room's (gl/room-light.js), so a person stands in the light the chair beside
//     them does, banded the same way with the comic look on.
//   · The face is the street's atlas (actor-faces.js), drawn as the street's head draws it, with the
//     scalp painted the hair's colour under the shell's edge.
//   · Hair cards are cut into strands here and alpha-tested, so they need no sorting; they're drawn
//     after everything opaque and the ink leaves them out (an outline pushed off a flat card is a
//     slab). The shell under them carries the hair's outline.
//   · Cloth seen from inside (up a sleeve, under a hem) is its lining: the same colour, darker.
//
// ⚠ NO FACE CULLING, as in room.js: the cloth is one-sided and is seen from both sides.

import { buildFigure, figureKey, somaOf, FIG_SLOT, FIG_PIECE, FIGURE_BONES, FIGURE_CUT_NAMES, FIGURE_CUTS } from '../figure.js';
import { FACE_GLSL, FACE_ATLAS } from '../actor-faces.js';
import { FACE, HAIRLINE_GLSL } from '../actor-head.js';
import { createFaceAtlasFeed } from './face-atlas.js';
import { declareProgram, layerProgram } from './programs.js';
import { ROOM_LIGHT_GLSL } from './room-light.js';
import { HOUSE } from './house-style.js';

export const FIG_BONE_ROWS = FIGURE_BONES.length * 12;
// how a cut's front is painted (FIGURE_CUTS front), as uCutF.x
const FRONT_KIND = { buttons: 1, zip: 2, pocket: 3, vest: 4, tunic: 5, suit: 6 };
const NB = FIGURE_BONES.length * 3;
const f4 = (v) => v.toFixed(4);

const SKIN_VS_GLSL = `
layout(location = 3) in vec4 aBones;
layout(location = 4) in vec4 aWeights;
uniform vec4 uBone[${NB}];
uniform vec3 uMouthA;        // the mouth's shape (client/shared/lip-sync.js): open, wide, round
// The jaw drops and the lips spread or purse in bind space, before the skin, in the body and its ink alike.
uniform float uBlink;        // the eyes: 0 open, 1 shut
uniform float uFaceUp;       // how far the sculpted face's lower half is lifted, in metres
// The face in thirds: everything from the nose down rides up, so the middle third shortens and the nose sits
// higher. It's done here, after the paint's coordinates are taken, so all the face's paint goes with it.
vec3 faceLift(vec3 p, float slot) {
  bool face = abs(slot - ${FIG_SLOT.face}.0) < 0.5 || abs(slot - ${FIG_SLOT.hair}.0) < 0.5 || abs(slot - ${FIG_SLOT.lid}.0) < 0.5;
  if (face && p.y < 1.64) p.y += uFaceUp * smoothstep(1.64, 1.588, p.y);
  return p;
}
vec3 mouthMorph(vec3 p, float slot, vec2 uv) {
  if (abs(slot - ${FIG_SLOT.lid}.0) < 0.5) { p.y += uBlink * uv.x * uv.y; return p; }
  if (uMouthA.x + uMouthA.y + uMouthA.z <= 0.0) return p;
  // a beard hangs below the skin's limit and goes with the jaw
  float m = smoothstep(0.02, 0.055, p.z) * (1.0 - smoothstep(0.055, 0.08, abs(p.x))) * (abs(slot - ${FIG_SLOT.hair}.0) < 0.5 ? 1.0 : smoothstep(1.505, 1.525, p.y)) * (1.0 - smoothstep(1.6, 1.625, p.y));
  float j = smoothstep(1.5665, 1.548, p.y), lip = exp(-pow(p.x / 0.04, 2.0) - pow((p.y - 1.565) / 0.018, 2.0));
  p.y -= uMouthA.x * 0.017 * j * m;
  p.z -= uMouthA.x * 0.004 * j * m;
  p.x *= 1.0 + (uMouthA.y * 0.14 - uMouthA.z * 0.3) * lip * m;
  p.z += uMouthA.z * 0.008 * lip * m;
  return p;
}
mat3x4 boneAt(float b) { int i = int(b + 0.5) * 3; return mat3x4(uBone[i], uBone[i + 1], uBone[i + 2]); }
vec3 skinAll(vec4 h) {
  return (h * boneAt(aBones.x)) * aWeights.x + (h * boneAt(aBones.y)) * aWeights.y + (h * boneAt(aBones.z)) * aWeights.z + (h * boneAt(aBones.w)) * aWeights.w;
}`;

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aUv;
layout(location = 5) in float aSlot;
layout(location = 6) in float aAux;
layout(location = 7) in vec3 aNorF;
${SKIN_VS_GLSL}
uniform mat4 uVP;
out vec3 vPos; out vec3 vNor; out vec3 vNorF; out vec3 vRest; out vec3 vMouthP; out vec2 vUv; out float vAux; flat out float vSlot;
void main() {
  vMouthP = mouthMorph(aPos, aSlot, aUv);
  vec3 p = skinAll(vec4(faceLift(vMouthP, aSlot), 1.0));
  vPos = p; vNor = skinAll(vec4(aNor, 0.0)); vNorF = skinAll(vec4(aNorF, 0.0)); vRest = aPos; vUv = aUv; vAux = aAux; vSlot = aSlot;
  gl_Position = uVP * vec4(p, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec3 vNorF; in vec3 vRest; in vec3 vMouthP; in vec2 vUv; in float vAux; flat in float vSlot;
uniform vec3 uCol[20];
uniform float uSurf[20];
uniform sampler2D uAtlas;
uniform vec4 uFace;          // layout, makeup, hair style, a seed
uniform vec3 uLip;
uniform vec3 uLipstick;
uniform vec3 uIris;
uniform int uCut;            // figure.js FIGURE_CUT_NAMES: 0 coat, 1 jacket, 2 tee
uniform vec3 uShade;         // the painted shadow (gl/house-style.js HOUSE.shade)
uniform vec3 uLine;          // the paint's ink (HOUSE.ink)
uniform vec4 uCutY;          // the cut's hem and cuff heights, whether there are knee pads, whether gloves
uniform vec3 uGlove;         // the gloves' colour
uniform vec4 uCutF;          // the cut's front (0 none, 1 buttons, 2 zip, 3 pocket, 4 vest, 5 tunic), rib, quilt, vent
uniform float uMantleHem;    // a mantle's hem, or 0
uniform vec4 uWild;          // Wildblood: dressed so, which face marks, a thornhide right arm, a seed
uniform vec3 uMark;          // their marks' pigment
uniform vec3 uWrap;          // their wraps' linen
uniform float uSculpt;       // the sculpted figure (docs/proposals/sculpted-figure.md): its paint, three tones and warm skin
uniform vec4 uFaceV;         // its face: brow weight, mouth width, beard, soft
uniform float uAge;          // how far its face has aged: 0 none, 1 old
uniform float uSmile;        // a settled grin, painted over the mouth: 0 none, 1 all of it
uniform vec3 uTrim;          // the piping on a suit's lapels
uniform vec3 uMouthA;        // the mouth: open, wide, round
uniform vec3 uMouthB;        // and pressed, teeth, tongue
uniform float uBlink;        // the eyes: 0 open, 1 shut
uniform float uRealEye;      // an eyeball behind the skin: the close-up level
uniform vec2 uGaze;          // where it's looking, in its own radii
uniform vec4 uBeardA;        // solid facial hair (figure.js FIGURE_FACIAL): cheeks, chin, moustache, sideburns
uniform vec3 uBeardB;        // and soul patch, jaw strap, the bars joining moustache to chin
uniform vec3 uSoma;          // what a body's weight shows on bare skin: muscle, ribs, fat (figure.js somaOf)
out vec4 outColor;
${ROOM_LIGHT_GLSL}
${FACE_GLSL}
${HAIRLINE_GLSL}
float hh(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// THE PAINT: line work drawn on the cloth in bind space, as a comic's inker draws seams, pockets and
// creases (docs/proposals/hd-figure.md, "The Borderlands pass"). A line is 'd' near 0, 'w' metres
// half-wide, antialiased to a pixel.
float inkL(float d, float w) { float aa = max(fwidth(d), 1e-5); return 1.0 - smoothstep(w, w + aa * 1.3, abs(d)); }
float inkBox(vec2 p, vec2 c, vec2 h, float w) { vec2 q = abs(p - c) - h; return inkL(max(q.x, q.y), w); }
float within(float v, float a, float b) { return step(a, v) * step(v, b); }
float paintCloth(int s, int piece, vec3 r, inout vec3 base, inout float mat) {
  // the line's half-width: heavy enough to hold as a figure gets smaller, as a comic's inking does
  float ink = 0.0, W = 0.0014, hem = uCutY.x, cuff = uCutY.y;
  float front = step(0.0, r.z);
  int fk = int(uCutF.x + 0.5);
  float ang = atan(r.x, r.z);
  if ((s == ${FIG_SLOT.top} || s == ${FIG_SLOT.cloak}) && piece == ${FIG_PIECE.torso}) {
    if (fk == 1) {
      ink = max(ink, inkL(r.y - mix(1.36, 1.335, front), W) * (1.0 - smoothstep(0.12, 0.15, abs(r.x))));
      for (int k = 0; k < 2; k++) {
        float cx = k == 0 ? 0.075 : -0.075;
        ink = max(ink, front * inkBox(r.xy, vec2(cx, 1.248), vec2(0.035, 0.03), W));
        ink = max(ink, front * inkL(r.y - 1.266, W) * within(abs(r.x - cx), 0.0, 0.035));
      }
      ink = max(ink, inkL(r.y - (hem + 0.035), W));
      if (uCut == 0 || uCut == 5) ink = max(ink, front * inkL(r.y - 0.905, W) * within(abs(r.x), 0.06, 0.14));
    } else if (fk == 2) {
      // a bomber's zip down the front, and its quilting in diamonds
      ink = max(ink, front * max(inkL(r.x, W * 1.2), 0.5 * inkL(r.x, 0.003) * step(0.5, fract(r.y * 220.0))));
      if (uCutF.z > 0.5 && uSculpt < 0.5 && r.y > hem + uCutF.y) {
        float qa = (fract((r.y + r.x * 0.9) / 0.055) - 0.5) * 0.055, qb = (fract((r.y - r.x * 0.9) / 0.055) - 0.5) * 0.055;
        ink = max(ink, 0.42 * max(inkL(qa, W * 0.7), inkL(qb, W * 0.7)));
      }
    } else if (fk == 3) {
      // a hoodie's pocket across the belly, open at its slanted ends, and its seam down the middle
      vec2 q = vec2(abs(r.x), r.y - 1.05);
      ink = max(ink, front * inkL(q.y - 0.055, W) * step(q.x, 0.085 - 0.02));
      ink = max(ink, front * inkL(q.x - 0.085 + 0.4 * (0.055 - q.y), W) * within(q.y, -0.055, 0.055));
      ink = max(ink, front * inkL(r.x, W * 0.8) * within(q.y, -0.055, 0.055) * 0.6);
    } else if (fk == 4) {
      // a vest: the shirt in its V, a welt pocket each side, buttons below the V
      // sculpted, the V opens at the neck, as a vest's does
      float vx = uSculpt > 0.5 ? max(0.0, (r.y - 1.22) * 0.3) : max(0.0, (1.455 - r.y) * 0.3);
      if (front > 0.5 && r.y > 1.2 && abs(r.x) < vx) base = uCol[${FIG_SLOT.shirt}];
      ink = max(ink, front * inkL(abs(r.x) - vx, W) * step(1.2, r.y));
      ink = max(ink, front * inkL(r.y - 1.03, W) * within(abs(r.x), 0.04, 0.11));
      for (int i = 0; i < 3; i++) { float d = length(vec2(r.x, r.y - (1.17 - float(i) * 0.065))), ab = max(fwidth(d), 1e-4); base = mix(base, base * 0.3, front * (1.0 - smoothstep(0.005, 0.005 + ab, d))); }
    } else if (fk == 5) {
      // a tunic: the woven band over its ragged hem, and an ash handprint over the heart
      float band = within(r.y, hem + 0.035, hem + 0.075);
      float chev = step(0.5, fract(ang * 5.0 + abs(fract(r.y * 45.0) - 0.5) * 2.0));
      base = mix(base, uMark * 0.9, band * chev * 0.85);
      ink = max(ink, max(inkL(r.y - (hem + 0.035), W), inkL(r.y - (hem + 0.075), W)));
      vec2 h = vec2(r.x - 0.07, r.y - 1.255);
      float palm = length(max(abs(h) - vec2(0.024, 0.026), 0.0)) - 0.006, hand = palm;
      for (int i = 0; i < 4; i++) { vec2 fp = h - vec2(-0.021 + float(i) * 0.014, 0.034); float lf = 0.026 - abs(float(i) - 1.5) * 0.004; hand = min(hand, length(vec2(fp.x, max(0.0, abs(fp.y - lf * 0.5) - lf * 0.5))) - 0.0055); }
      vec2 tp = h - vec2(0.036, 0.0); hand = min(hand, length(vec2(tp.x - tp.y * 0.6, max(0.0, abs(tp.y + 0.004) - 0.012))) - 0.006);
      float ah = max(fwidth(hand), 1e-4);
      base = mix(base, vec3(0.42, 0.41, 0.4) * (0.8 + 0.3 * vn3(r * 300.0)), front * 0.85 * (1.0 - smoothstep(0.0, ah * 1.5, hand)));
    } else {
      ink = max(ink, inkL(r.y - (hem + 0.022), W * 0.8));
    }
    // a knitted rib at the hem
    if (uCutF.y > 0.0 && r.y < hem + uCutF.y) ink = max(ink, 0.4 * inkL((fract(ang * 9.5) - 0.5) * 0.02, W * 0.6));
    if (uCutF.y > 0.0) ink = max(ink, inkL(r.y - (hem + uCutF.y), W));
    // a duster's vent up the back
    if (uCutF.w > 0.5) ink = max(ink, (1.0 - front) * inkL(r.x, W) * step(r.y, 0.78));
    if (fk != 5) ink = max(ink, inkL(r.z + 0.004, W) * step(0.1, abs(r.x)) * step(r.y, 1.39));
  } else if (piece == ${FIG_PIECE.mantle}) {
    // a mantle's ragged edge darker, and on a Wildblood's the tally over the heart in ash: a stroke is
    // a Gift and a ring a Lesson, the rings bigger
    base *= mix(0.72, 1.0, smoothstep(uMantleHem, uMantleHem + 0.05, r.y));
    if (uWild.x > 0.5 && front > 0.5) {
      float t = 0.0, n1 = 2.0 + floor(hh(uWild.w) * 3.0), n2 = 1.0 + floor(hh(uWild.w + 1.7) * 2.0);
      for (int i = 0; i < 4; i++) if (float(i) < n1) t = max(t, inkL(r.x - (0.05 + float(i) * 0.011), 0.0016) * within(r.y, 1.318, 1.348));
      for (int j = 0; j < 2; j++) if (float(j) < n2) t = max(t, inkL(length(vec2(r.x - (0.058 + float(j) * 0.03), r.y - 1.292)) - 0.011, 0.0018));
      base = mix(base, vec3(0.5, 0.49, 0.47), 0.85 * t);
    }
  } else if (piece == ${FIG_PIECE.hood}) {
    ink = max(ink, inkL(r.z + 0.07, W * 1.3));
  } else if (s == ${FIG_SLOT.top} && piece == ${FIG_PIECE.sleeve}) {
    float lat = abs(r.x) - 0.195;
    if (fk == 1) ink = max(ink, inkL(r.y - (cuff + 0.05), W));
    if (uCutF.y > 0.0 && r.y < cuff + 0.035) ink = max(ink, 0.4 * inkL((fract(atan(r.x - sign(r.x) * 0.195, r.z) * 6.0) - 0.5) * 0.02, W * 0.6));
    if (uCutF.y > 0.0) ink = max(ink, inkL(r.y - (cuff + 0.035), W));
    // a bomber's patch on the left shoulder
    if (uCut == 4 && uSculpt < 0.5 && r.x > 0.0 && lat > 0.02) { float d = length(vec2(r.z + 0.005, r.y - 1.3)); base = mix(base, uCol[${FIG_SLOT.legs}] * 1.2, 1.0 - smoothstep(0.02, 0.021, d)); ink = max(ink, inkL(d - 0.02, W)); }
    ink = max(ink, inkL(r.z + 0.01, W) * step(0.02, lat) * step(r.y, 1.37));
    // the elbow's creases, on the inside of the arm
    float inner = 1.0 - smoothstep(0.0, 0.025, abs(lat + 0.03));
    ink = max(ink, 0.8 * inner * front * (inkL(r.y - 1.112 - 0.004 * r.z / 0.04, W * 0.9) + inkL(r.y - 1.094 + 0.003 * r.z / 0.04, W * 0.8)));
  } else if (s == ${FIG_SLOT.legs} && piece == ${FIG_PIECE.cuff}) {
    // a rolled cuff: its fold, and its inside darker below the fold
    ink = max(ink, inkL(r.y - 0.252, W));
    if (r.y < 0.252) base *= 0.82;
  } else if (s == ${FIG_SLOT.legs}) {
    float lx = abs(r.x) - 0.095;
    ink = max(ink, inkL(r.z - 0.004, W) * step(0.03, lx));
    if (lx > 0.035) {
      ink = max(ink, inkBox(vec2(r.z, r.y), vec2(0.0, 0.675), vec2(0.045, 0.055), W));
      ink = max(ink, inkL(r.y - 0.716, W) * within(abs(r.z), 0.0, 0.045));
    }
    if (uCutY.z < 0.5 && uSculpt < 0.5) ink = max(ink, step(0.02, r.z) * max(inkL(r.y - 0.462, W), inkL(r.y - 0.578, W)));
    ink = max(ink, inkL(r.y - 0.985, W));
  } else if (s == ${FIG_SLOT.shoes}) {
    if (piece != ${FIG_PIECE.boot} && r.y < 0.026) base *= 0.42;
    ink = max(ink, inkL(r.y - 0.027, W));
    if (piece == ${FIG_PIECE.boot}) {
      ink = max(ink, inkL(r.y - 0.222, W));
      // the laces up the front: crossed, in the leg's own frame
      float lx = r.x - sign(r.x) * 0.095, u = fract((r.y - 0.08) / 0.022) - 0.5;
      ink = max(ink, inkL(abs(lx) - abs(u) * 0.022, W * 0.9) * (1.0 - smoothstep(0.011, 0.014, abs(lx))) * step(0.025, r.z) * step(r.y, 0.215));
    } else {
      ink = max(ink, inkL(r.z - 0.118, W) * step(0.03, r.y));
    }
  } else if (s == ${FIG_SLOT.gear}) {
    if (piece == ${FIG_PIECE.belt}) {
      vec2 q = abs(vec2(r.x, r.y - 1.005)) - vec2(0.02, 0.015);
      if (front > 0.5 && max(q.x, q.y) < 0.0) { base = vec3(0.5, 0.47, 0.4); mat = 6.0; }
      ink = max(ink, front * inkL(max(q.x, q.y), W));
    } else if (piece == ${FIG_PIECE.pouch}) {
      ink = max(ink, inkL(r.y - 0.99, W));
    } else {
      // the strap's stitching along both edges, a dashed line
      ink = max(ink, 0.55 * step(0.5, fract((r.x + r.z) * 90.0)) * max(inkL(r.y - (1.24 + 1.9 * r.x + 0.017), W * 0.6), inkL(r.y - (1.24 + 1.9 * r.x - 0.017), W * 0.6)));
    }
  } else if (s == ${FIG_SLOT.pad}) {
    ink = max(ink, inkL(r.y - 0.515, W * 1.3));
  }
  // wear: lighter flecks where the edges and the gear take the knocks
  float edge = 0.0;
  if (s == ${FIG_SLOT.top}) edge = piece == ${FIG_PIECE.sleeve} ? 1.0 - smoothstep(0.0, 0.03, r.y - cuff) : 1.0 - smoothstep(0.0, 0.035, r.y - hem);
  else if (s == ${FIG_SLOT.collar}) edge = smoothstep(1.47, 1.5, r.y);
  else if (s == ${FIG_SLOT.shoes}) edge = max(smoothstep(0.12, 0.165, r.z), 1.0 - smoothstep(0.02, 0.045, r.y));
  else if (s == ${FIG_SLOT.pad} || s == ${FIG_SLOT.gear}) edge = 0.7;
  float nz = vn3(r * 140.0) * 0.6 + vn3(r * 47.0) * 0.4;
  base = mix(base, base * 1.45 + 0.03, 0.55 * smoothstep(0.6, 0.76, nz) * edge);
  // and the cloth painted, not printed: a broad uneven value, as if brushed
  base *= 0.93 + 0.14 * vn3(r * 9.0 + vec3(uFace.w));
  return ink;
}
// THE SCULPTED PAINT, in bind space, costing no triangles. A fold is a soft dark stroke with a lit
// edge beside it, as a colourist lays one over flat cloth; the construction lines go in as ink.
float segD(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0)); }
void fold(vec2 p, vec2 a, vec2 b, float w, float k, inout vec3 base) {
  float d = segD(p, a, b), e = segD(p, a + vec2(w * 0.8, w), b + vec2(w * 0.8, w));
  base *= 1.0 - k * (1.0 - smoothstep(0.0, w, d));
  base *= 1.0 + 0.55 * k * (1.0 - smoothstep(0.0, w * 0.8, e));
}
float triD(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a, e1 = c - b, e2 = a - c, v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0), q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0), q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float sg = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), sg * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), sg * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(q2, q2), sg * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
// a flat painted shadow with a crisp edge, in the skin's own warm shadow colour
float darkSkin() { return smoothstep(0.17, 0.07, dot(uCol[0], vec3(0.333))); }
void shape(float d, float k, inout vec3 base) { float aa = max(fwidth(d), 1e-4); base *= mix(vec3(1.0), mix(vec3(0.74, 0.6, 0.58), vec3(0.74, 0.68, 0.76), darkSkin()), k * (1.0 - smoothstep(-aa, aa, d))); }
// What a body's weight shows on bare skin. The relief alone doesn't: the form normals smooth most of it
// away, so the muscles, ribs and folds are drawn in the house manner, as the face is. A form is one inked
// contour that swells and tapers to nothing, with a flat shadow shape on its right (looking from a to b),
// and hatching in the outer part of that shadow. 'bow' curves it to the left, 'w' is the ink's half-width
// and 'sh' how deep the shadow runs. A woman's chest isn't drawn.
void form(vec2 p, vec2 a, vec2 b, float bow, float w, float sh, float k, inout vec3 base) {
  if (k <= 0.0) return;
  vec2 ab = b - a; float L = length(ab); vec2 u = ab / L, n = vec2(-u.y, u.x);
  float t = dot(p - a, u) / L, tc = clamp(t, 0.0, 1.0), on = step(0.0, t) * step(t, 1.0);
  float off = dot(p - a, n) - bow * 4.0 * tc * (1.0 - tc), tp = pow(sin(3.14159 * tc), 0.75), aa = max(fwidth(off), 1e-4);
  // one continuous distance, with the stroke's ends in it: a jump here would draw itself as a line of antialiasing
  if (sh > 0.0) shape(max(max(off, -off - sh * tp), max(-t, t - 1.0) * L), 0.85 * k, base);
  float hc = (p.x + p.y) / 0.0042, fw = fwidth(hc), st = (1.0 - smoothstep(0.26, 0.34, abs(fract(hc) - 0.5))) * (1.0 - smoothstep(0.25, 0.5, fw));
  base *= 1.0 - 0.42 * k * on * st * step(-sh * tp, off) * step(off, -0.4 * sh * tp);
  base = mix(base, min(uLine, uCol[0] * 0.2), k * on * (1.0 - smoothstep(w * tp, w * tp + aa, abs(off))));
}
void paintBody(int piece, vec3 r, inout vec3 base) {
  float M = uSoma.x, Rb = uSoma.y, Z = uSoma.z, ax = abs(r.x);
  vec2 q = vec2(ax, r.y), p = vec2(r.z, r.y);
  if (piece == ${FIG_PIECE.sleeve}) {
    // the deltoid's lower edge, the split between biceps and triceps, the forearm's long muscle
    form(p, vec2(-0.06, 1.3), vec2(0.06, 1.3), -0.045, 0.0016, 0.02, M, base);
    form(p, vec2(-0.012, 1.125), vec2(-0.008, 1.262), -0.005, 0.0013, 0.016, M, base);
    form(p, vec2(-0.008, 0.95), vec2(0.024, 1.085), 0.006, 0.0011, 0.007, 0.85 * M, base);
    // a thin arm's elbow, a soft arm's sag
    form(p, vec2(-0.032, 1.1), vec2(-0.006, 1.082), 0.003, 0.0009, 0.004, Rb, base);
    form(p, vec2(-0.07, 1.2), vec2(-0.012, 1.15), 0.008, 0.0012, 0.012, 0.7 * Z, base);
    return;
  }
  if (r.z >= 0.0) {
    if (uFaceV.w < 0.5) {
      // the pectorals' lower edge, rounding up into the armpit, and the breastbone between them
      form(q, vec2(0.006, 1.3), vec2(0.16, 1.325), -0.04, 0.0021, 0.028, M, base);
      form(q, vec2(0.0, 1.29), vec2(0.0, 1.408), 0.0, 0.0012, 0.0, 0.8 * M, base);
    }
    // the abdominals: down the middle, the lines across, the outer edge with its shadow, the V into the hips
    form(q, vec2(0.0, 1.262), vec2(0.0, 1.03), 0.0, 0.0013, 0.0, 0.9 * M, base);
    for (int i = 0; i < 3; i++) { float y = 1.214 - float(i) * 0.054 - float(i * i) * 0.002; form(q, vec2(0.004, y), vec2(0.056, y + 0.012), -0.005, 0.0013, 0.0075, 0.9 * M, base); }
    form(q, vec2(0.05, 1.03), vec2(0.052, 1.262), 0.014, 0.0016, 0.02, M, base);
    form(q, vec2(0.05, 0.96), vec2(0.128, 1.075), 0.012, 0.0016, 0.018, M, base);
    // the ribs' ends down the flank
    for (int i = 0; i < 3; i++) { float y = 1.25 - float(i) * 0.04; form(q, vec2(0.122, y), vec2(0.165, y + 0.022), 0.003, 0.0011, 0.008, 0.85 * M, base); }
    // a thin chest: the ribs running down and out, the collarbones, the breastbone and the hip bones
    for (int i = 0; i < 4; i++) { float y = 1.312 - float(i) * 0.04; form(q, vec2(0.048, y), vec2(0.138, y - 0.034), 0.006, 0.001, 0.0115, 0.85 * Rb, base); }
    form(q, vec2(0.014, 1.418), vec2(0.136, 1.442), 0.005, 0.0013, 0.008, Rb, base);
    form(q, vec2(0.0, 1.405), vec2(0.0, 1.27), 0.0, 0.001, 0.0, 0.7 * Rb, base);
    form(q, vec2(0.094, 1.0), vec2(0.126, 1.05), 0.005, 0.0011, 0.007, 0.85 * Rb, base);
    // a soft body: the crease under the chest, the navel sunk in the belly, the roll at the side
    if (uFaceV.w < 0.5) form(q, vec2(0.014, 1.232), vec2(0.178, 1.245), -0.03, 0.0016, 0.024, 0.9 * Z, base);
    float nv = length((q - vec2(0.0, 1.05)) / vec2(0.0065, 0.011)), an = max(fwidth(nv), 1e-3);
    base = mix(base, min(uLine, uCol[0] * 0.2), 0.85 * Z * (1.0 - smoothstep(1.0 - an, 1.0 + an, nv)));
    form(q, vec2(0.145, 1.13), vec2(0.225, 1.105), -0.01, 0.0015, 0.02, 0.9 * Z, base);
  } else {
    // the back: the spine's channel, the shoulder blades, and a soft back's rolls
    form(q, vec2(0.0, 1.41), vec2(0.0, 1.03), 0.0, 0.0015, 0.0, 0.9 * M + 0.7 * Rb, base);
    form(q, vec2(0.15, 1.232), vec2(0.058, 1.385), 0.03, 0.0017, 0.024, M + 0.8 * Rb, base);
    form(q, vec2(0.145, 1.13), vec2(0.225, 1.105), -0.01, 0.0015, 0.02, 0.9 * Z, base);
    form(q, vec2(0.01, 1.112), vec2(0.15, 1.08), -0.012, 0.0015, 0.018, 0.8 * Z, base);
  }
}
// Skin as paint: broad uneven brushwork, then grit and pores, which give out before they'd turn to grey
// noise at a distance. A soft face takes a little of it.
void skinPaint(vec3 r, float rough, inout vec3 base) {
  float bw = vn3(r * vec3(36.0, 64.0, 36.0)) * 0.6 + vn3(r * 110.0) * 0.4;
  base *= 1.0 + mix(0.08, 0.2, rough) * (bw - 0.5);
  float fade = 1.0 - smoothstep(0.3, 0.7, fwidth(r.x * 1150.0) + fwidth(r.y * 1150.0));
  base *= 1.0 - mix(0.04, 0.13, rough) * smoothstep(0.62, 0.7, vn3(r * 1150.0)) * fade;
  base *= 1.0 + mix(0.02, 0.1, rough) * smoothstep(0.66, 0.74, vn3(r * 430.0 + 7.0)) * fade;
}
void deep(float d, float k, inout vec3 base) { float aa = max(fwidth(d), 1e-4); base *= mix(vec3(1.0), vec3(0.6, 0.53, 0.55), k * (1.0 - smoothstep(-aa, aa, d))); }
float paintSculpt(int s, int piece, vec3 r, inout vec3 base) {
  if (s == ${FIG_SLOT.skin}) skinPaint(r, 0.6 * (1.0 - uFaceV.w), base);
  if (s == ${FIG_SLOT.skin} && r.y > 0.9 && uSoma.x + uSoma.y + uSoma.z > 0.0) paintBody(piece, r, base);
  float ink = 0.0, W = 0.0011, hem = uCutY.x, cuff = uCutY.y, front = step(0.0, r.z), ax = abs(r.x);
  vec2 q = vec2(ax, r.y);
  int fkS = int(uCutF.x + 0.5);
  bool built = fkS == 2 || uCut <= 1, suit = fkS == 6;
  if (s == ${FIG_SLOT.top} && piece == ${FIG_PIECE.torso}) {
    // the yoke, and the panels below it a shade apart: a jacket's or coat's construction, not a tee's
    float yoke = built ? 1.372 - 0.12 * ax * front : 9.0;
    base *= r.y > yoke ? 1.09 : (ax > 0.1 && built ? 0.95 : 1.0);
    ink = max(ink, inkL(r.y - yoke, W));
    // stitching beside the seam, a lighter thread
    base = mix(base, base * 1.9 + 0.012, 0.6 * inkL(r.y - yoke + 0.005, 0.0006) * step(0.5, fract((r.x + r.z) * 110.0)));
    // the front left open from the collar to the breastbone, over a dark shirt with its placket
    if (front > 0.5 && built) {
      float vx = max(0.0, (r.y - 1.3) * 0.34) * step(1.3, r.y);
      if (ax < vx) { base = mix(uCol[${FIG_SLOT.top}] * 0.45, vec3(0.018, 0.02, 0.03), 0.5); ink = max(ink, 0.8 * inkL(r.x - 0.009, W * 0.8)); }
      ink = max(ink, inkL(ax - vx, W * 1.2) * step(1.3, r.y));
      // the panel seams, curving in to the hem, and a chest pocket each side with its flap and stud
      float px = 0.1 - 0.03 * smoothstep(1.34, hem, r.y) + 0.02 * smoothstep(1.2, 1.36, r.y);
      ink = max(ink, inkL(ax - px, W) * within(r.y, hem + uCutF.y, yoke));
      ink = max(ink, inkBox(q, vec2(0.135, 1.262), vec2(0.03, 0.036), W));
      ink = max(ink, inkL(r.y - 1.285, W * 1.2) * within(ax, 0.103, 0.167));
      float st = length(q - vec2(0.135, 1.276)), aa = max(fwidth(st), 1e-4);
      base = mix(base, base * 0.3, 1.0 - smoothstep(0.0032, 0.0032 + aa, st));
      // slash pockets at the waist
      ink = max(ink, step(segD(q, vec2(0.095, 1.05), vec2(0.13, 1.14)), W * 1.1));
    }
    // a suit: open from the collar to its one button over the shirt and tie, the lapels notched and piped
    if (front > 0.5 && suit) {
      float vx = max(0.0, (r.y - 1.14) * 0.25), aw = max(fwidth(ax), 1e-4);
      if (ax < vx) {
        base = uCol[${FIG_SLOT.shirt}] * 1.0;
        float knot = 1.402, tw = r.y > knot ? 0.0135 - 0.2 * (r.y - knot) : 0.0085 + 0.1 * (knot - r.y);
        if (ax < tw) { base = uCol[${FIG_SLOT.shirt}] * 0.55 + 0.012 * step(0.0, r.x); }
        ink = max(ink, inkL(ax - tw, W));
        ink = max(ink, inkL(r.y - knot, W * 0.8) * step(ax, 0.0135));
      } else {
        // the lapel: out from the button to its point, in to the notch, out again and up to the collar
        vec2 l0 = vec2(0.0, 1.14), l1 = vec2(0.128, 1.368), l2 = vec2(0.096, 1.388), l3 = vec2(0.122, 1.418), l4 = vec2(0.074, 1.452);
        float xo = r.y < l1.y ? l1.x * (r.y - l0.y) / (l1.y - l0.y) : r.y < l2.y ? mix(l1.x, l2.x, (r.y - l1.y) / (l2.y - l1.y)) : r.y < l3.y ? mix(l2.x, l3.x, (r.y - l2.y) / (l3.y - l2.y)) : mix(l3.x, l4.x, (r.y - l3.y) / (l4.y - l3.y));
        if (ax < xo && r.y > l0.y) base = base * 1.5 + 0.006;
        float e = min(min(segD(q, l0, l1), segD(q, l1, l2)), min(segD(q, l2, l3), segD(q, l3, l4))), ae = max(fwidth(e), 1e-4);
        base = mix(base, uTrim, 1.0 - smoothstep(0.0016, 0.0016 + ae, e));
      }
      base = mix(base, uTrim, 0.8 * (1.0 - smoothstep(0.0009, 0.0009 + aw, abs(ax - vx))) * step(1.14, r.y));
      // the front's edge under the button, the button, and a welt pocket each side
      ink = max(ink, inkL(r.x + 0.004 * smoothstep(1.14, hem, r.y) * 6.0, W) * step(r.y, 1.14));
      float st = length(vec2(r.x, r.y - 1.13)), ab = max(fwidth(st), 1e-4);
      base = mix(base, base * 0.3 + 0.01, 1.0 - smoothstep(0.0065, 0.0065 + ab, st));
      ink = max(ink, inkL(r.y - 1.03, W) * within(ax, 0.09, 0.16));
    }
    // cloth pulling from the armpits, gathering above the waistband and hanging at the small of the back
    fold(q, vec2(0.17, 1.27), vec2(0.1, 1.215), 0.011, 0.26, base);
    fold(q, vec2(0.175, 1.235), vec2(0.115, 1.17), 0.01, 0.22, base);
    fold(q, vec2(0.15, hem + 0.1), vec2(0.07, hem + 0.065), 0.01, 0.24, base);
    fold(q, vec2(0.04, hem + 0.09), vec2(0.015, hem + 0.058), 0.008, 0.2, base);
    fold(q, vec2(0.16, hem + 0.17), vec2(0.1, hem + 0.12), 0.009, 0.18, base);
  } else if (s == ${FIG_SLOT.top} && piece == ${FIG_PIECE.sleeve}) {
    // the shoulder's seam, a tab over it, and the elbow's breaks
    float lz = r.z, top = 1.36 + 0.02 * lz / 0.05;
    ink = max(ink, inkL(r.y - top, W));
    base *= r.y > top ? 1.09 : 1.0;
    float tb = max(abs(r.z - 0.005) - 0.014, 0.0);
    if (built) ink = max(ink, 0.9 * inkL(tb, W) * within(r.y, 1.372, 1.405));
    vec2 p = vec2(r.z, r.y);
    fold(p, vec2(-0.045, 1.135), vec2(0.04, 1.105), 0.01, 0.3, base);
    fold(p, vec2(-0.04, 1.095), vec2(0.04, 1.07), 0.009, 0.26, base);
    fold(p, vec2(-0.03, 1.19), vec2(0.04, 1.155), 0.009, 0.2, base);
    fold(p, vec2(-0.035, cuff + 0.085), vec2(0.03, cuff + 0.06), 0.008, 0.22, base);
    fold(p, vec2(-0.04, 1.3), vec2(0.03, 1.26), 0.009, 0.14, base);
  } else if (s == ${FIG_SLOT.legs}) {
    float lx = ax - 0.095;
    vec2 p = vec2(lx, r.y);
    // denim worn pale down the front of the thigh and at the knee, darker in the seams
    float wearK = front * exp(-pow((lx + 0.002) / 0.04, 2.0)) * (0.5 * smoothstep(0.92, 0.72, r.y) * smoothstep(0.5, 0.62, r.y) + exp(-pow((r.y - 0.52) / 0.05, 2.0)));
    base *= 1.0 + 0.3 * wearK;
    base *= 1.0 - 0.2 * smoothstep(0.03, 0.075, abs(lx));
    // the front pockets, the fly, the knee's breaks and the stack over the boot
    if (front > 0.5) {
      ink = max(ink, step(segD(q, vec2(0.16, 0.985), vec2(0.105, 0.925)), W));
      ink = max(ink, inkL(r.x - 0.012, W) * within(r.y, 0.86, 1.0));
    }
    fold(p, vec2(-0.05, 0.56), vec2(0.045, 0.535), 0.009, 0.24, base);
    fold(p, vec2(-0.045, 0.495), vec2(0.05, 0.47), 0.009, 0.26, base);
    fold(p, vec2(-0.05, 0.84), vec2(0.03, 0.8), 0.011, 0.2, base);
    fold(p, vec2(-0.03, 0.31), vec2(0.04, 0.285), 0.008, 0.2, base);
    fold(p, vec2(-0.04, 0.37), vec2(0.03, 0.345), 0.008, 0.14, base);
  }
  // wear on the jacket: broad faded patches, the shoulders and chest sun-worn, scuffs along the raised edges
  if (s == ${FIG_SLOT.top} || s == ${FIG_SLOT.collar}) {
    base *= 0.9 + 0.22 * vn3(r * 16.0 + 3.0);
    base *= 1.0 + 0.2 * smoothstep(1.28, 1.4, r.y);
    float scuff = smoothstep(0.62, 0.72, vn3(r * 75.0)) * (0.5 + 0.5 * vn3(r * 240.0));
    base = mix(base, base * 1.5 + 0.012, 0.28 * scuff * max(smoothstep(1.34, 1.4, r.y), piece == ${FIG_PIECE.sleeve} ? exp(-pow((r.y - 1.1) / 0.05, 2.0)) : 0.0));
  }
  return ink;
}
void main() {
  int s = int(vSlot + 0.5);
  vec3 n = normalize(vNor), v = normalize(uEye - vPos);
  // the form normal (figure.js formNormals), turned with the surface when it's cloth seen from inside
  vec3 nf = normalize(vNorF) * (s != ${FIG_SLOT.card} && dot(n, v) < 0.0 ? -1.0 : 1.0);
  vec3 skin = uCol[0], hair = uCol[4];
  vec3 base = uCol[s];
  float mat = uSurf[s];
  if (s == ${FIG_SLOT.card}) {
    // a card cut into strands, each ending at its own length and thinning to its tip
    // a card is a few chunky clumps, each tapering to a point, inked round its edge with a stroke of
    // light down it, as a comic draws hair
    float seed = vAux * 97.0, strands = 2.0 + floor(hh(seed) * 2.0);
    float u = vUv.x * strands, id = floor(u), f = fract(u);
    float len = 0.75 + 0.25 * hh(seed + id * 3.1);
    float w = 0.48 * (1.0 - smoothstep(len * 0.3, len, vUv.y)) + 0.04;
    if (vUv.y > len || abs(f - 0.5) > w) discard;
    float prof = abs(f - 0.5) / w;
    base = hair * (0.62 + 0.45 * vUv.y) * (0.9 + 0.2 * hh(seed + id));
    base += hair * 0.55 * (1.0 - smoothstep(0.0, 0.18, abs(f - 0.5 - 0.1 * w))) * smoothstep(0.25, 0.45, vUv.y) * (1.0 - smoothstep(0.55, 0.8, vUv.y));
    base = mix(base, uLine, 0.75 * smoothstep(0.72, 0.95, prof));
    mat = uSurf[${FIG_SLOT.hair}];
  } else {
    bool inside = dot(n, v) < 0.0;
    if (inside) n = -n;
    // cloth seen from inside is its lining
    if (inside && (s == ${FIG_SLOT.top} || s == ${FIG_SLOT.legs} || s == ${FIG_SLOT.shoes} || s == ${FIG_SLOT.collar})) base *= 0.42;
  }
  // a coat's or a jacket's front: the overlapping panel's edge down the front, its shadow on the
  // panel under it, and the buttons beside the edge. Drawn, not built: a line in bind space.
  bool longCoat = uCut == 0 || uCut == 5;
  if (s == ${FIG_SLOT.top} && int(uCutF.x + 0.5) == 1 && vRest.z > 0.02 && int(vAux + 0.5) == ${FIG_PIECE.torso}) {
    float ex = vRest.x + 0.02, aa = max(fwidth(vRest.x), 1e-4);
    base *= mix(0.32, 1.0, smoothstep(0.0009, 0.0009 + aa * 1.5, abs(ex)));
    if (ex < 0.0) base *= mix(0.78, 1.0, smoothstep(0.0, 0.009, -ex));
    float by0 = longCoat ? 1.3 : 1.14, step_ = longCoat ? 0.12 : 0.105;
    int nb = longCoat ? 4 : 2;
    for (int i = 0; i < 4; i++) {
      if (i >= nb) break;
      float d = length(vec2(vRest.x + 0.006, vRest.y - (by0 - float(i) * step_))), ab = max(fwidth(d), 1e-4);
      base = mix(base, base * 0.28 + vec3(0.015), 1.0 - smoothstep(0.0062, 0.0062 + ab, d));
    }
  }
  bool eyeHole = false;
  if (s == ${FIG_SLOT.eye}) {
    // the ball: whites greying to the corners, a flat iris with a dark rim and a light low in it, the lid's shadow across the top
    float soft = uFaceV.w, sgn = sign(vRest.x);
    vec2 u = vUv - uGaze;
    float d = length(u), aa = max(fwidth(d), 1e-3), R = mix(0.6, 0.64, soft);
    vec3 e = mix(vec3(0.62, 0.58, 0.54), vec3(0.8, 0.76, 0.72), soft) * (1.0 - 0.45 * smoothstep(0.5, 1.3, abs(vUv.x)));
    e = mix(e, skin * vec3(1.0, 0.68, 0.66), smoothstep(-0.92, -1.2, sgn * vUv.x));
    e = mix(e, uIris * mix(1.35, 0.7, smoothstep(0.25, 1.0, d / R)), 1.0 - smoothstep(R - aa, R + aa, d));
    e = mix(e, uIris * 0.22, inkL(d - R, 0.04));
    e = mix(e, vec3(0.012), 1.0 - smoothstep(0.24 - aa, 0.24 + aa, d));
    e = mix(e, vec3(0.88), 1.0 - smoothstep(0.085 - aa, 0.085 + aa, distance(u, vec2(-0.17, 0.2))));
    e *= mix(1.0, mix(0.3, 0.46, soft), smoothstep(mix(-0.18, -0.06, soft), mix(0.2, 0.34, soft), vUv.y));
    base = e * mix(1.0, 0.7, darkSkin());
    mat = uSurf[${FIG_SLOT.eye}];
  } else if (s == ${FIG_SLOT.lid}) {
    // the top of a lid is skin, its underside the lash line above and the wet rim below
    base = skin * 0.97;
    if (vUv.x > 0.5) base = mix(min(uLine, skin * 0.12), base, smoothstep(mix(0.62, 0.46, uFaceV.w), mix(0.76, 0.6, uFaceV.w), vAux));
    else base = mix(skin * vec3(0.92, 0.6, 0.58), base, smoothstep(0.5, 0.72, vAux));
    mat = uSurf[${FIG_SLOT.lid}];
  } else if (s == ${FIG_SLOT.face}) {
    vec3 r = vRest;
    float lay = uFace.x;
    vec4 cell = vec4(mod(lay, ${FACE_ATLAS.cols}.0) / ${FACE_ATLAS.cols}.0, (${FACE_ATLAS.rows - 1}.0 - floor(lay / ${FACE_ATLAS.cols}.0 + 0.001)) / ${FACE_ATLAS.rows}.0,
      1.0 / ${FACE_ATLAS.cols}.0, 1.0 / ${FACE_ATLAS.rows}.0);
    vec2 uv = clamp((r.xy - vec2(${f4(FACE.x0)}, ${f4(FACE.y0)})) / vec2(${f4(FACE.x1 - FACE.x0)}, ${f4(FACE.y1 - FACE.y0)}), 0.0, 1.0);
    vec4 m = texture(uAtlas, cell.xy + uv * cell.zw);
    float wet;
    // sculpted, the brows and beard are painted, so the atlas's own hair stays in the skin's colour:
    // in the hair's it blotches a cheek when the hair is pale or dyed
    base = faceColour(m, r, skin, uSculpt > 0.5 ? skin * 0.92 : hair, uLip, uLipstick, uFace.y, uIris, wet);
    if (wet > 0.25 && uSculpt < 0.5) mat = 4.0;
    if (uSculpt > 0.5) {
      // every line on a sculpted face is drawn below, so nothing of the atlas stays: its lines were painted
      // to read at street distance, and close up they look like scratches
      base = skin;
      skinPaint(r, 1.0 - uFaceV.w, base);
      float sx = sign(r.x), ax = abs(r.x);
      vec2 q = vec2(ax, r.y + (r.x > 0.0 ? -0.0012 : 0.0)), q0 = vec2(ax, r.y);
      // the eye, painted over the atlas's: greyed whites under the lid's shadow, a flat iris with a dark rim, one catchlight
      float soft = uFaceV.w, hard = 1.0 - soft;
      // a man's narrow and level under a heavy lid, a soft face's wider and tilted up at the outer corner
      float eW = mix(0.0158, 0.0168, soft), eT = mix(0.0051, 0.0074, soft), eB = mix(0.0034, 0.0052, soft);
      float eX = mix(0.0292, 0.0312, soft), ex = ax - eX, eyeK = max(0.0, 1.0 - pow(ex / eW, 2.0)), eyeT = 1.6398 + mix(0.02, 0.07, soft) * ex;
      float eyeS = 1.0 - smoothstep(-0.0002, 0.0002, max(r.y - eyeT - eT * eyeK, eyeT - eB * eyeK - r.y));
      float eyeM = eyeS * step(abs(ex), eW);
      // the real eye sits behind a hole in the skin, which a blink closes from the top
      if (uRealEye > 0.5) { eyeHole = r.z > 0.0 && abs(ex) < eW && r.y > eyeT - eB * eyeK && r.y < eyeT + mix(eT, -eB, uBlink) * eyeK; eyeM = 0.0; }
      // a blink: the lid comes down over all of it
      base = mix(base, skin * 0.93, uBlink * eyeM);
      eyeM *= 1.0 - uBlink;
      if (eyeM > 0.002) {
        vec2 ec = vec2(sx * eX, 1.6398);
        float d = distance(r.xy, ec), aa = max(fwidth(d), 0.0002), R = mix(0.0066, 0.0082, soft);
        vec3 e = mix(vec3(0.74, 0.7, 0.65), vec3(0.84, 0.8, 0.76), soft) * mix(1.0, mix(0.5, 0.6, soft), smoothstep(mix(1.6372, 1.6385, soft), mix(1.6442, 1.6455, soft), r.y)) * (1.0 - 0.3 * smoothstep(0.006, 0.016, d));
        e = mix(e, uIris * mix(1.25, 0.72, smoothstep(0.3, 1.0, d / R)), 1.0 - smoothstep(R - aa, R + aa, d));
        e = mix(e, uLine, inkL(d - R, 0.0005));
        e = mix(e, vec3(0.012), 1.0 - smoothstep(0.0029 - aa, 0.0029 + aa, d));
        e = mix(e, vec3(0.85), 1.0 - smoothstep(0.001 - aa, 0.001 + aa, distance(r.xy, ec + vec2(-0.0021, 0.0023))));
        base = mix(base, e * mix(1.0, 0.62, darkSkin()), eyeM);
      }
      if (r.z > 0.0) {
        // the planes as flat shapes: the socket under the brow, the wedge under the cheekbone, the temple,
        // under the lip, and the sliver under the nose
        // the socket in two depths: all of it, and darker still under the brow and in beside the nose
        float sock = eyeM > 0.5 ? 0.0 : 1.0;
        deep(length((q0 - vec2(eX + 0.0033, 1.6478)) / vec2(0.0242, 0.0085)) - 1.0, sock * mix(0.72, 0.1, soft), base);
        deep(length((q0 - vec2(eX + 0.0056, 1.651)) / vec2(0.0225, 0.0036)) - 1.0, sock * 0.6 * hard, base);
        // the wedge from the brow's inner end down beside the nose
        deep(triD(q0, vec2(eX - 0.0205, 1.6515), vec2(eX - 0.0065, 1.651), vec2(eX - 0.0165, 1.6368)) - 0.0012, sock * 0.62 * hard, base);
        // the wedge under the cheekbone, pointing at the mouth, its corners rounded; the temple, and the light on the bone
        float fz = smoothstep(0.0, 0.04, r.z);
        shape(triD(q0, vec2(0.086, 1.612), vec2(0.047, 1.593), vec2(0.07, 1.545)) - 0.0035, 0.85 * hard * fz * (1.0 - 0.9 * uSoma.z), base);
        shape(triD(q0, vec2(0.078, 1.69), vec2(0.066, 1.655), vec2(0.078, 1.63)), mix(0.5, 0.1, soft), base);
        base *= 1.0 + 0.09 * hard * (1.0 - smoothstep(0.92, 1.0, length((q0 - vec2(0.05, 1.6235)) / vec2(0.019, 0.0062))));
        shape(length((q0 - vec2(0.0, 1.5505)) / vec2(0.0115, 0.0024)) - 1.0, 0.3 * soft, base);
        shape(length((q0 - vec2(0.0, 1.5855)) / vec2(mix(0.0135, 0.0095, soft), 0.0026)) - 1.0, mix(0.9, 0.35, soft), base);
        // nostrils, and the side of the nose away from the light
        float nd = length((q0 - vec2(mix(0.0078, 0.0064, soft), 1.5866)) / (vec2(0.0034, 0.0012) * mix(1.0, 0.75, soft))) - 1.0;
        base = mix(base, skin * mix(0.3, 0.5, soft), 1.0 - smoothstep(-0.15, 0.15, nd));
        vec3 key0 = normalize((dot(uLampC, vec3(0.333)) > 0.01 ? uLampP[0] : uWinP[0]) - vPos);
        float away = smoothstep(0.015, 0.05, dot(normalize(vNorF), key0) - dot(n, key0));
        shape(ax - mix(0.0026, 0.004, soft) - mix(0.0115, 0.0105, soft) * pow(smoothstep(1.648, 1.598, r.y), 1.6), mix(0.8, 0.2, soft) * away * within(r.y, 1.592, 1.648), base);
      }
      // the hair's shadow on the forehead, and cooler skin at the jaw
      shape(hairlineSculpt(r) - 0.012 + 0.004 * (vn3(r * 90.0) - 0.5) - r.y, 0.75, base);
      base *= mix(vec3(1.0), vec3(0.93, 0.96, 1.02), (1.0 - soft) * smoothstep(1.575, 1.53, r.y));
      // warmth over the nose, cheeks and chin, and the forehead's plane a little paler
      base *= mix(vec3(1.0), vec3(1.05, 0.93, 0.87), mix(0.8, 0.3, soft) * exp(-pow(ax / 0.022, 2.0) - pow((r.y - 1.602) / 0.02, 2.0)) + mix(0.55, 0.95, soft) * exp(-pow((ax - 0.05) / 0.02, 2.0) - pow((r.y - 1.602) / 0.02, 2.0)));
      base *= 1.0 + 0.05 * smoothstep(1.665, 1.685, r.y);
      // the beard's shadow, a flat tone with a broken edge, clear of the lips
      float back = smoothstep(0.03, -0.03, r.z);
      float edge = 1.586 + 0.01 * (vn3(r * 260.0) - 0.5) - 0.022 * smoothstep(0.035, 0.068, ax) - 0.03 * back;
      float mouth = 1.0 - smoothstep(0.75, 1.1, length(vec2(r.x / 0.03, (r.y - 1.565) / 0.0125)));
      float beard = smoothstep(edge, edge - 0.008, r.y) * (1.0 - mouth);
      float fadeZ = smoothstep(-0.05, 0.05, r.z + 0.03 * (vn3(r * 180.0) - 0.5));
      // the beard stays dark, whatever the hair's colour
      vec3 beardC = min(hair, vec3(0.09));
      base = mix(base, mix(skin * vec3(0.72, 0.66, 0.66), beardC, 0.3), 0.55 * beard * fadeZ * min(1.0, uFaceV.z * 1.4));
      // stubble: short strokes running down the face, thickest at the beard's edge
      float fleck = smoothstep(0.68, 0.72, vn3(vec3(r.x * 2200.0, r.y * 620.0, r.z * 2200.0)));
      base = mix(base, beardC * 1.6, 0.4 * step(0.01, uFaceV.z) * fleck * fadeZ * smoothstep(edge + 0.006, edge, r.y) * smoothstep(edge - 0.016, edge - 0.004, r.y) * (1.0 - mouth));
      // heavy brows drawn as one tapering mass, the lid's line, the crease under the eye, a furrow
      if (r.z > 0.0) {
        // a soft face's fine lines stay darker than its skin, whatever the skin
        vec3 lineS = mix(skin * vec3(0.15, 0.1, 0.1), min(uLine, skin * 0.26), soft);
        // a soft face's stand higher off the eye, in a curved arch
        // a man's sit right on the eye, low at the nose and angled in, and stop short of the temple
        float bx = q.x - 0.044, bd = min(segD(q, vec2(0.0108, 1.6508), vec2(0.0395, 1.6588)), segD(q, vec2(0.0395, 1.6588), vec2(0.0572, 1.6532)));
        bd = mix(bd, length(vec2(max(max(0.0145 - q.x, q.x - 0.0655), 0.0), q.y - 1.6695 + (bx < 0.0 ? 9.0 : 20.0) * bx * bx)), soft);
        float bw = mix(mix(0.0044, 0.0036, soft), mix(0.0014, 0.0022, soft), smoothstep(0.012, 0.064, ax)) * uFaceV.x, ab = max(fwidth(bd), 1e-4);
        // hairs run out along the brow, with a ragged edge, so it isn't one flat slab
        float browS = vn3(vec3(r.x * 240.0, r.y * 1500.0, 3.0));
        base = mix(base, hair * mix(0.55, 1.15, browS * hard + 0.5 * soft), (1.0 - smoothstep(bw, bw + ab, bd + mix(0.0014, 0.0003, soft) * (browS - 0.5))));
        // THE MOUTH, one drawing for every shape it can be in, in the jaw's moved coordinates: the upper lip's
        // edge, the opening under it, the lower lip under that. Lips in two tones with a stroke of light,
        // inked where they meet. Everything is measured from the corners in, so it closes up at any width.
        float mx = abs(vMouthP.x), my_ = vMouthP.y, op = uMouthA.x, wd = uMouthA.y, rd = uMouthA.z, pr = uMouthB.x;
        // a grin gives way to the sounds being made and comes back between them
        float grin = uSmile * (1.0 - 0.85 * clamp(2.0 * op + pr + 0.6 * uMouthB.y + rd, 0.0, 1.0)), W = mix(0.0228, 0.021, soft) * uFaceV.y * (1.0 + 0.3 * wd + 0.42 * grin - 0.44 * rd);
        float t2 = min(1.0, pow(mx / W, 2.0)), kk = 1.0 - t2, inW = step(mx, W), aL = max(fwidth(my_), 1e-4);
        // a man's line isn't straight: it dips at the middle, rises each side of that, falls to the corners, and one
        // corner sits a touch higher than the other
        float closedK = hard * (1.0 - grin) * (1.0 - op);
        float yu = 1.5652 + 0.0016 * grin + (mix(-0.0014, 0.00045, soft) + 0.0044 * grin + 0.0012 * wd) * t2
          + closedK * (0.00085 * exp(-pow((mx - 0.0105) / 0.0075, 2.0)) - 0.0005 * exp(-pow(mx / 0.0042, 2.0)) + 0.0004 * t2 * sign(vMouthP.x));
        float gap = op * 0.0165 + grin * 0.0122, yl = yu - gap * pow(kk, mix(1.0, 0.6, rd));
        float hU = mix(0.0033, 0.0072, soft) * (1.0 - 0.4 * pr) * (1.0 - 0.3 * wd) * (1.0 - 0.25 * uAge) * (1.0 + 0.35 * rd);
        float hL = mix(0.0047, 0.0092, soft) * (1.0 - 0.45 * pr) * (1.0 - 0.25 * wd) * (1.0 - 0.2 * uAge) * (1.0 + 0.3 * rd);
        // the bow in the upper lip: a dip at the middle between two peaks
        float top = yu + hU * pow(kk, 0.7) - 0.0012 * exp(-pow(mx / 0.0042, 2.0)) + 0.0006 * exp(-pow((mx - 0.0075) / 0.005, 2.0));
        float bot = yl - hL * pow(kk, 0.6);
        // a man's are hardly a colour at all: the upper in shadow, the lower the skin warmed a little
        vec3 lipUp = mix(skin * mix(vec3(0.6, 0.44, 0.42), vec3(0.74, 0.36, 0.36), soft), uLipstick * 0.75, 0.75 * uFace.y);
        vec3 lipLo = mix(skin * mix(vec3(0.94, 0.78, 0.74), vec3(0.9, 0.5, 0.48), soft), uLipstick, 0.75 * uFace.y);
        // the shadow the upper lip's bow lays on itself, and the lower lip's light and the two creases at its middle
        lipUp *= 1.0 - 0.2 * smoothstep(yu + hU * 0.75, yu, my_);
        float lipLight = (1.0 - smoothstep(0.75, 1.0, length(vec2((vMouthP.x + 0.0035 * hard) / (W * mix(0.26, 0.5, soft)), (my_ - (yl - hL * 0.42)) / (hL * mix(0.13, 0.2, soft))))));
        lipLo = mix(lipLo, min(lipLo * 1.5 + 0.02, vec3(1.0)), mix(0.4, 0.8, soft) * lipLight);
        lipLo *= 1.0 - 0.14 * (1.0 - smoothstep(0.0003, 0.0007, abs(mx - 0.0052))) * smoothstep(yl, yl - hL * 0.3, my_) * smoothstep(yl - hL, yl - hL * 0.6, my_);
        lipLo *= 1.0 - 0.3 * smoothstep(yl - hL * 0.55, yl - hL, my_);
        base = mix(base, lipUp, inW * smoothstep(top + aL, top - aL, my_) * step(yu, my_));
        base = mix(base, lipLo, inW * smoothstep(bot - aL, bot + aL, my_) * step(my_, yl));
        // inside: dark, the top teeth hanging from the upper lip, the lower teeth if the jaw's right down, the tongue
        float inside = inW * step(yl, my_) * step(my_, yu);
        if (inside > 0.0) {
          vec3 inner = vec3(0.045, 0.016, 0.018) * mix(1.0, 1.7, smoothstep(0.0, 0.8, kk));
          float tH = mix(mix(0.0, 0.0044, uMouthB.y), gap * 0.86, grin), tE = yu - tH * pow(kk, 0.3);
          float tongueY = yl + gap * mix(0.2, 0.72, uMouthB.z) * pow(max(0.0, 1.0 - pow(mx / (W * 0.62), 2.0)), 0.5) * step(0.01, uMouthB.z + 0.3 * op);
          inner = mix(inner, skin * vec3(0.5, 0.22, 0.24), smoothstep(tongueY + aL, tongueY - aL, my_) * step(mx, W * 0.62));
          vec3 tooth = vec3(0.92, 0.9, 0.84) * mix(1.0, 0.62, smoothstep(0.45, 1.0, mx / W));
          // a line between each tooth, gone before it would turn to grey
          float tl = mx / 0.0064; tooth *= 1.0 - 0.3 * (1.0 - smoothstep(0.05, 0.1, abs(fract(tl + 0.5) - 0.5))) * (1.0 - smoothstep(0.2, 0.45, fwidth(tl)));
          inner = mix(inner, tooth, smoothstep(tE - aL, tE + aL, my_));
          float lE = yl + 0.002 * smoothstep(0.55, 0.9, op);
          inner = mix(inner, tooth * 0.8, smoothstep(lE + aL, lE - aL, my_) * step(mx, W * 0.5));
          base = mix(base, inner, inside);
        }
        // the ink: where the lips meet, swelling at the middle and gone at the corners, and round the opening
        vec3 lineM = mix(skin * vec3(0.17, 0.11, 0.1), min(lineS, skin * 0.3), soft);
        // the shadow under the lower lip is what shapes a man's mouth: a crescent, tight to the lip and deepest at the middle
        { float cw = W * 0.78, ck = max(0.0, 1.0 - pow(mx / cw, 2.0)), cTop = bot + 0.0002; deep(max(my_ - cTop, cTop - 0.0048 * ck - 0.0002 - my_), 0.8 * hard * step(mx, cw), base); }
        // swelling at the middle and thinning to nothing at the corners
        base = mix(base, lineM, 0.95 * inkL(my_ - yu, mix(mix(0.00078, 0.00095, soft) * (1.0 - t2 * t2 * hard) + 0.00005, mix(0.00095, 0.00035, sqrt(t2)), soft) * (1.0 + 0.5 * pr)) * step(mx, W + 0.0012 * soft));
        base = mix(base, lineM, 0.7 * step(0.0002, gap) * inkL(my_ - yl, 0.0004) * inW);
        base = mix(base, lineM, 0.32 * inkL(my_ - top, 0.00028) * step(mx, W * 0.86));
        base = mix(base, lineM, 0.35 * inkL(my_ - bot, 0.0003) * step(mx, W * 0.5));
        // the corner, tucked in, with a short tick when the face is set
        shape(length(vec2((mx - W - 0.0006) / mix(0.0012, 0.0022, soft), (my_ - yu) / mix(0.0022, 0.0028, soft))) - 1.0, mix(0.4, 0.55, soft), base);
        base = mix(base, skin * 0.5, (1.0 - soft) * (1.0 - grin) * (1.0 - op) * 0.7 * (1.0 - smoothstep(0.0003, 0.0006, segD(vec2(mx, my_), vec2(W + 0.0018, yu + 0.0016), vec2(W + 0.0034, yu - 0.0024)))));
        // the two ridges from the nose down to the bow
        shape(abs(ax - 0.0042 - 0.18 * (1.5845 - r.y)) - 0.0008, 0.3 * within(r.y, 1.5725, 1.5845), base);
        // SOLID FACIAL HAIR: each area a distance, the nearest of them drawn over a contact shadow, with a ragged
        // edge and streaks running down. It stops at the lips, which have to stay clear to move.
        if (dot(uBeardA, vec4(1.0)) + dot(uBeardB, vec3(1.0)) > 0.0) {
          float streak = vn3(vec3(r.x * 1100.0, r.y * 260.0, r.z * 1100.0)), nzB = vn3(r * 420.0), dB = 1.0;
          if (uBeardA.z > 0.5) { float yT = 1.5838 - 14.0 * ax * ax - 0.0022 * exp(-pow(ax / 0.0022, 2.0)), yB = 1.5716 - 12.0 * ax * ax; dB = min(dB, max(max(yB - r.y, r.y - yT), ax - 0.0318)); }
          if (uBeardA.y > 0.5) dB = min(dB, (length((q0 - vec2(0.0, 1.5395)) / vec2(0.0245, 0.0125)) - 1.0) * 0.0125);
          if (uBeardB.z > 0.5) dB = min(dB, segD(q0, vec2(0.0295, 1.5625), vec2(0.0225, 1.541)) - 0.0032);
          if (uBeardB.x > 0.5) dB = min(dB, (length((q0 - vec2(0.0, 1.5472)) / vec2(0.0058, 0.0052)) - 1.0) * 0.0052);
          if (uBeardB.y > 0.5) dB = min(dB, max((0.86 - length((q0 - vec2(0.0, 1.592)) / vec2(0.0775, 0.068))) * 0.06, r.y - 1.592));
          // a sideburn runs down from the hair in front of the ear, narrowing to a rounded end
          if (uBeardA.w > 0.5) { float sw = mix(0.0035, 0.0115, smoothstep(1.578, 1.635, r.y)); dB = min(dB, max(abs(r.z - 0.0115 - 0.1 * (1.64 - r.y)) - sw, 1.576 - r.y)); }
          if (uBeardA.x > 0.5) { float clearM = (length(vec2(mx / (W + 0.0045), (my_ - 0.5 * (yu + yl)) / (0.5 * gap + 0.0105))) - 1.0) * 0.01; dB = min(dB, max(max(r.y - 1.5685 - 0.95 * max(0.0, ax - 0.033), -clearM), 0.004 + 0.55 * (1.6 - r.y) - r.z)); }
          float lipIn = inW * step(bot, my_) * step(my_, top), inside2 = 1.0 - lipIn;
          shape(dB - 0.0014, 0.6 * inside2, base);
          float aB = max(fwidth(dB), 1e-4), dE = dB + 0.0014 * (nzB - 0.5) + 0.0011 * (streak - 0.5);
          base = mix(base, hair * mix(0.8, 1.5, streak), inside2 * (1.0 - smoothstep(-aB, aB, dE)));
        }
        // a big smile pushes lines into the cheeks and round the eyes
        if (uSmile > 0.0) {
          float fold1 = min(segD(q0, vec2(0.0185, 1.5945), vec2(0.0345, 1.5775)), segD(q0, vec2(0.0345, 1.5775), vec2(0.0372, 1.5655)));
          base = mix(base, skin * 0.5, uSmile * 0.85 * (1.0 - smoothstep(0.0004, 0.0009, fold1)));
          base = mix(base, skin * 0.55, uSmile * 0.7 * (1.0 - smoothstep(0.0003, 0.0006, segD(q0, vec2(0.0512, 1.6365), vec2(0.0555, 1.6345)))));
          base = mix(base, skin * 0.55, uSmile * 0.7 * (1.0 - smoothstep(0.0003, 0.0006, segD(q0, vec2(0.0505, 1.6325), vec2(0.054, 1.629)))));
          base = mix(base, skin * 0.6, uSmile * 0.6 * inkL(r.y - (1.6305 + 30.0 * (ax - 0.0312) * (ax - 0.0312)), 0.0005) * step(abs(ax - 0.0312), 0.013));
        }
        // a man's face in ink: nose to mouth, the two lines between the brows, the forehead, the cheek and the chin
        form(q0, vec2(0.0205, 1.592), vec2(0.0305, 1.5745), 0.0016, 0.00055, 0.0026, hard * (1.0 - uSmile) * 0.55, base);
        form(q0, vec2(0.0082, 1.669), vec2(0.0064, 1.657), -0.0008, 0.0005, 0.0016, hard * 0.45, base);
        form(q0, vec2(0.0, 1.5485), vec2(0.0, 1.5395), 0.0, 0.0004, 0.0, hard * 0.3 * (1.0 - uSoma.z), base);
        // a full face: the fold under the chin, the jowl off the mouth's corner, puffed under the eye
        form(q0, vec2(0.0, 1.5335), vec2(0.056, 1.5475), -0.008, 0.0007, 0.0055, uSoma.z * 0.6, base);
        form(q0, vec2(0.02, 1.63), vec2(0.05, 1.629), -0.003, 0.0004, 0.0018, uSoma.z * 0.55, base);
        // the nose: light down the bridge and on the tip, each wing drawn as a short arc, a crease off it
        base *= 1.0 + mix(0.05, 0.02, soft) * step(ax, 0.0016 + 0.05 * (1.646 - r.y)) * within(r.y, 1.612, 1.646);
        base *= 1.0 + mix(0.14, 0.09, soft) * (1.0 - smoothstep(0.9, 1.0, length(vec2(r.x / mix(0.0062, 0.0052, soft), (r.y - 1.6005) / 0.0058))));
        vec2 wv = q0 - vec2(mix(0.0135, 0.0105, soft), 1.5925);
        float wing = inkL(length(wv) - mix(0.0072, 0.0054, soft), 0.00045) * step(0.0, wv.x) * step(-0.0058, wv.y) * step(wv.y, 0.0046);
        base = mix(base, skin * 0.42, mix(0.55, 0.22, soft) * wing);
                // age: lines across the forehead, deep folds from the nose, bags under the eyes, jowls
        if (uAge > 0.0) {
          vec3 lineC = skin * 0.5; float ak = 0.75 * uAge;
          for (int i = 0; i < 3; i++) { float fy = 1.672 + float(i) * 0.0085 + 0.012 * ax * ax / 0.003 * 0.1; base = mix(base, lineC, ak * inkL(r.y - fy, 0.0005) * step(ax, 0.052 - float(i) * 0.008)); }
          base = mix(base, lineC, ak * (1.0 - smoothstep(0.0004, 0.0008, segD(q0, vec2(0.0235, 1.5885), vec2(0.0345, 1.5575)))));
          base = mix(base, lineC, ak * (1.0 - smoothstep(0.0003, 0.0007, segD(q0, vec2(0.0295, 1.5535), vec2(0.0385, 1.5425)))));
          base = mix(base, lineC, ak * inkL(r.y - (1.6235 + 22.0 * (ax - 0.0312) * (ax - 0.0312)), 0.0005) * step(abs(ax - 0.0312), 0.015));
          base = mix(base, lineC, ak * (1.0 - smoothstep(0.0003, 0.0006, segD(q0, vec2(0.052, 1.64), vec2(0.06, 1.645)))));
          base = mix(base, lineC, ak * (1.0 - smoothstep(0.0003, 0.0006, segD(q0, vec2(0.052, 1.636), vec2(0.06, 1.634)))));
        }
        // the upper lid: one heavy tapering shape cutting the top of the iris, with a flick at the outer corner
        float lid = mix(eyeT + eT * eyeK, 1.6352 + 9.0 * ex * ex, uBlink), lw = mix(mix(0.0023, 0.0009, smoothstep(0.0, 0.0152, abs(ex + 0.002))), mix(0.001, 0.0021, smoothstep(-0.012, 0.014, ex)), soft) * smoothstep(0.0, 0.3, eyeK);
        // a man's lid is a shape of its own over the eye, a heavy fold
        deep(max(r.y - (lid + 0.0034 * eyeK + 0.0006), lid - r.y), 0.45 * hard * step(abs(ex), eW), base);
        base = mix(base, lineS, (1.0 - uRealEye) * inkL(r.y - lid + lw * 0.7, lw) * step(abs(ex), eW - 0.0002));
        // the flick: down off the outer corner, or on a soft eye a short wing up, thick at its root
        vec2 f0 = vec2(mix(0.0468, 0.0455, soft), mix(1.6417, 1.6422, soft)), f1 = vec2(mix(0.0505, 0.0525, soft), mix(1.6398, 1.6436, soft));
        float fl = segD(q0, f0, f1), af = max(fwidth(fl), 1e-4), flw = mix(0.0006, mix(0.0009, 0.0002, clamp(dot(q0 - f0, f1 - f0) / dot(f1 - f0, f1 - f0), 0.0, 1.0)), soft);
        base = mix(base, lineS, soft * (1.0 - smoothstep(flw, flw + af, fl)));
        // a soft eye's lower lid
        base = mix(base, skin * 0.5, (1.0 - uRealEye) * mix(0.5, 0.7, soft) * inkL(r.y - (eyeT - eB * eyeK), 0.00035) * step(abs(ex), eW));
        base = mix(base, skin * 0.62, 0.7 * inkL(r.y - (lid + mix(0.0052, 0.0034, soft) - 12.0 * ex * ex), 0.0005) * step(abs(ex), 0.016));
        base = mix(base, skin * 0.68, (1.0 - soft) * 0.3 * inkL(r.y - (1.6285 + 26.0 * ex * ex), 0.0006) * step(abs(ex + 0.002), 0.013));
        base = mix(base, skin * 0.7, (1.0 - soft) * 0.55 * inkL(ax - 0.0055 - 0.3 * (r.y - 1.652), 0.0006) * within(r.y, 1.646, 1.664));
      }
    }
    // the scalp under the hair's edge, the hair's colour
    float hl = uSculpt > 0.5 ? hairlineSculpt(r) : hairlineAt(r);
    // sculpted, the shell's own colour, so its stepped edge doesn't show on pale hair
    // sculpted, the line breaks into short points running down onto the skin
    if (uSculpt > 0.5 && uFace.z > 0.5) { float ha = atan(r.x, r.z - 0.0), tri = abs(fract(ha * 4.1 + 0.9 * vn3(vec3(ha * 3.0, 2.0, uFace.w))) - 0.5) * 2.0; hl -= 0.0062 * pow(tri, 3.0) * (0.45 + vn3(vec3(ha * 11.0, 1.0, uFace.w))) * smoothstep(1.25, 0.75, abs(ha)); }
    base = mix(base, uSculpt > 0.5 ? (uFace.z < 0.5 ? mix(skin * 0.72, hair * 0.75, 0.5) : hair * 0.75) : hair * 0.9, smoothstep(hl - 0.0012, hl + 0.0012, r.y));
    base *= 1.0 - 0.18 * smoothstep(1.534, 1.522, r.y);
  } else if (s == ${FIG_SLOT.ear}) {
    base = skin * vec3(1.03, 0.94, 0.92) * (1.0 - (uSculpt > 0.5 ? 0.62 : 0.3) * vAux);
    // the rim of the ear's bowl, drawn
    if (uSculpt > 0.5) {
      base = mix(base, skin * 0.6, 0.4 * inkL(vAux - 0.4, 0.035));
      // its folds, in metres from its middle, turned to stand up straight: the rim, the fold inside it, the bowl, the flap at the front
      float ca = cos(0.2), sa = sin(0.2); vec2 e0 = vec2(vRest.z + 0.014, vRest.y - 1.62), ep = vec2(ca * e0.x + sa * e0.y, -sa * e0.x + ca * e0.y);
      skinPaint(vRest, 0.7 * (1.0 - uFaceV.w), base);
      deep(length((ep - vec2(0.0015, -0.0025)) / vec2(0.0072, 0.0105)) - 1.0, 0.8, base);
      deep(length((ep - vec2(0.0035, -0.004)) / vec2(0.0042, 0.0062)) - 1.0, 0.7, base);
      form(ep, vec2(0.0085, 0.0125), vec2(-0.0105, -0.008), 0.0095, 0.0006, 0.0028, 0.9, base);
      form(ep, vec2(0.0005, 0.0125), vec2(-0.0035, -0.0085), 0.003, 0.0005, 0.0016, 0.6, base);
      base *= 1.0 + 0.14 * (1.0 - smoothstep(0.8, 1.0, length((ep - vec2(0.0088, -0.0055)) / vec2(0.0028, 0.0042))));
    }
  } else if (s == ${FIG_SLOT.neck}) {
    // the jaw's shadow on the throat
    base = skin * (1.0 - 0.3 * smoothstep(1.49, 1.535, vRest.y) * smoothstep(-0.02, 0.025, vRest.z));
    // the jaw's shadow as a shape, its edge following the jaw round the throat
    if (uSculpt > 0.5 && uBeardA.x > 0.5) base = mix(base, hair * 0.5, smoothstep(1.498, 1.508, vRest.y + 0.3 * vRest.z) * smoothstep(-0.02, 0.02, vRest.z));
    if (uSculpt > 0.5) { skinPaint(vRest, 0.7 * (1.0 - uFaceV.w), base); shape(1.503 + 0.32 * max(0.0, -vRest.z - 0.01) + 0.9 * vRest.x * vRest.x - vRest.y, 0.9, base); }
  } else if (s == ${FIG_SLOT.hair} && vAux > 0.5) {
    // a lock: dark at its root and along its edges, a stroke of light down its middle
    float lseed = vAux * 31.0, u = vUv.x, t = vUv.y;
    base = hair * (0.86 + 0.28 * hh(lseed)) * mix(0.72, 1.1, smoothstep(0.0, 0.4, t));
    base += hair * 1.5 * (1.0 - smoothstep(0.1, 0.42, abs(u - 0.4))) * smoothstep(0.15, 0.42, t) * (1.0 - smoothstep(0.5, 0.85, t));
    base = mix(base, hair * 0.08, smoothstep(0.68, 0.9, u));
    // soft streaks down the lock: hard lines across a lock's few columns draw a maze on pale hair
    if (uSculpt > 0.5) base *= 0.84 + 0.32 * vn3(vec3(u * 6.0, t * 1.1, lseed));
    mat = uSurf[${FIG_SLOT.skin}];
  } else if (s == ${FIG_SLOT.hair}) {
    // a crop is stubble over the scalp, thinning to skin at its edge, not a cap
    float cropK = uFace.z < 0.5 ? 0.55 + 0.45 * smoothstep(0.0, 0.03, vRest.y - hairlineSculpt(vRest)) : 1.0;
    base = uSculpt > 0.5 ? mix(skin * 0.72, hair * 0.75, cropK * (uFace.z < 0.5 ? 0.45 + 0.75 * vn3(vRest * 620.0) : 1.0)) : hair * (0.82 + 0.2 * hh(floor(atan(vRest.x, vRest.z) * 40.0) + uFace.w));
  }
  float ink = 0.0;
  int piece = int(vAux + 0.5);
  if (s == ${FIG_SLOT.top} || s == ${FIG_SLOT.legs} || s == ${FIG_SLOT.shoes} || s == ${FIG_SLOT.collar} || s == ${FIG_SLOT.gear} || s == ${FIG_SLOT.pad} || s == ${FIG_SLOT.cloak} || s == ${FIG_SLOT.shirt})
    ink = paintCloth(s == ${FIG_SLOT.shirt} ? ${FIG_SLOT.top} : s, piece, vRest, base, mat);
  if (uSculpt > 0.5) {
    ink = max(ink, paintSculpt(s, piece, vRest, base));
    // the hand: warm at the knuckles and fingertips
    if (s == ${FIG_SLOT.skin} && vRest.y < 0.885) base *= mix(vec3(1.0), vec3(1.02, 0.84, 0.78), smoothstep(0.8, 0.77, vRest.y) * 0.75);
    // creases the light doesn't reach: the sides of the body behind the arms, under the jacket's hem
    if (s == ${FIG_SLOT.legs} && vRest.y > uCutY.x - 0.05 && vRest.y < uCutY.x) base *= mix(0.55, 1.0, smoothstep(uCutY.x, uCutY.x - 0.05, vRest.y));
    if (s == ${FIG_SLOT.top} && int(vAux + 0.5) == ${FIG_PIECE.torso}) base *= 1.0 - 0.32 * smoothstep(0.13, 0.19, abs(vRest.x)) * smoothstep(1.32, 1.24, vRest.y);
  }
  // salvage: the goggles' strap dark, their rims the city's blue, the lenses glass
  if (s == ${FIG_SLOT.salvage}) {
    if (piece == ${FIG_PIECE.goggles}) base *= 0.32;
    else if (vRest.z > 0.104 && length(vec2(abs(vRest.x) - 0.032, vRest.y - 1.703)) < 0.0135) { base = vec3(0.04, 0.1, 0.13); mat = 4.0; }
    ink = max(ink, piece == ${FIG_PIECE.lens} ? inkL(length(vec2(abs(vRest.x) - 0.032, vRest.y - 1.703)) - 0.0135, 0.0009) : 0.0);
  }
  // horn and bone: ridges round a horn, a claw darkening to its point, teeth and thorns as they grew
  if (s == ${FIG_SLOT.horn}) {
    if (piece == ${FIG_PIECE.claw}) base *= 0.45;
    else if (piece == ${FIG_PIECE.horn}) base *= 0.82 + 0.18 * step(0.5, fract((vRest.y + abs(vRest.x) * 0.3) * 160.0));
    base *= 0.9 + 0.2 * vn3(vRest * 200.0);
    mat = 5.0;
  }
  // a Wildblood's own: marks in their pigment on the face and the backs of the hands, linen wraps
  // on a forearm and both shins, and a thornhide arm's bark
  if (uWild.x > 0.5) {
    vec3 r = vRest;
    float st = uWild.y, mk = 0.0;
    if (s == ${FIG_SLOT.face}) {
      if (st < 0.5) mk = within(r.y, 1.627, 1.653) * (1.0 - smoothstep(0.062, 0.075, abs(r.x)));
      else if (st < 1.5) { for (int i = 0; i < 3; i++) { float x0 = 0.032 + float(i) * 0.012; mk = max(mk, (1.0 - smoothstep(0.002, 0.0035, abs(r.x - x0 - (1.625 - r.y) * 0.16))) * within(r.y, 1.565, 1.625)); } }
      else if (st < 2.5) mk = max((1.0 - smoothstep(0.008, 0.011, abs(r.x))) * within(r.y, 1.523, 1.562), 1.0 - smoothstep(0.007, 0.009, length(vec2(r.x, r.y - 1.69))));
      else mk = within(r.y, 1.668, 1.69) * (1.0 - smoothstep(0.055, 0.07, abs(r.x)));
      base = mix(base, uMark, 0.92 * mk * (0.8 + 0.25 * vn3(r * 260.0)));
    }
    if (s == ${FIG_SLOT.skin} && abs(r.x) > 0.15) {
      bool thorn = uWild.z > 0.5 && r.x < 0.0;
      if (thorn && r.y < 1.13) {
        // bark: plates parted by cracks, a cell pattern over the arm
        vec3 p = r * 70.0, ip = floor(p); float f1 = 9.0, f2 = 9.0;
        for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec3 c = ip + vec3(x, y, z); vec3 o = c + vec3(h3(c), h3(c + 7.1), h3(c + 13.3)); float d = length(p - o);
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
        base = mix(base, base * vec3(0.55, 0.5, 0.4), 0.85 * smoothstep(1.13, 1.08, r.y));
        ink = max(ink, 0.8 * (1.0 - smoothstep(0.0, 0.09, f2 - f1)) * smoothstep(1.13, 1.09, r.y));
      } else if (r.y > 0.89 && r.y < 1.04) {
        base = uWrap * (0.88 + 0.2 * vn3(r * 90.0)); mat = 1.0;
        ink = max(ink, 0.6 * inkL((fract(r.y / 0.019 + atan(r.z, abs(r.x) - 0.195) * 0.16) - 0.5) * 0.019, 0.0008));
      }
      if (!thorn && r.y > 0.8 && r.y < 0.845) base = mix(base, uMark, 0.7 * within(r.y, 0.81, 0.835));
    }
    if (s == ${FIG_SLOT.legs} && r.y > 0.09 && r.y < 0.42) {
      base = uWrap * (0.88 + 0.2 * vn3(r * 90.0));
      ink = max(ink, 0.6 * inkL((fract(r.y / 0.021 + atan(r.z, abs(r.x) - 0.095) * 0.16) - 0.5) * 0.021, 0.0009));
    }
  }
  // fingerless gloves: the palm and the fingers' roots, a cuff at the wrist
  if (s == ${FIG_SLOT.skin} && uCutY.w > 0.5 && abs(vRest.x) > 0.15 && vRest.y < 0.885 && vRest.y > 0.756) {
    base = uGlove * (0.93 + 0.14 * vn3(vRest * 60.0)); mat = 3.0;
    ink = max(inkL(vRest.y - 0.87, 0.001), inkL(vRest.y - 0.758, 0.0008) * 0.7);
  }
  // a little darker low down, where the room's light doesn't reach
  base *= 0.72 + 0.28 * clamp(vRest.y / 0.9, 0.0, 1.0);
  // The comic light (gl/comic-light.js, in ROOM_LIGHT_GLSL): lit or in shadow by the FORM, so a head or a limb takes
  // one clean shadow shape and the small forms only shade within it. The key is the lamp while it's
  // on, else the window; its light on a surface square to it is the room's own, so the tones still
  // follow the lamp and the hour. Only hard materials keep a highlight, and it's hard too.
  bool lampOn = dot(uLampC, vec3(0.333)) > 0.01;
  vec3 key = normalize((lampOn ? uLampP[0] : uWinP[0]) - vPos);
  vec3 dFull, sFull, diff, spec;
  roomLight(vPos, key, v, mat, dFull, sFull);
  roomLight(vPos, n, v, mat, diff, spec);
  float lit;
  // the scalp under the hair's edge is painted on the face but lights as hair, or it shows through on dark skin
  bool scalp = uSculpt > 0.5 && s == ${FIG_SLOT.face} && vRest.y > hairlineSculpt(vRest);
  bool flesh = (s == 0 || s == ${FIG_SLOT.face} || s == ${FIG_SLOT.ear} || s == ${FIG_SLOT.neck} || s == ${FIG_SLOT.lid}) && !scalp;
  float dkS = uSculpt > 0.5 ? darkSkin() : 0.0;
  vec3 shadeC = uSculpt > 0.5 && flesh ? mix(vec3(0.76, 0.58, 0.53), vec3(0.72, 0.62, 0.74), dkS) : uShade;
  vec3 c = comicTone(base, nf, n, v, key, dFull, uAmb, shadeC, lit);
  if (uSculpt > 0.5) {
    // a third tone between the light and the terminator, and a thin light along the lit edges
    // on a man's skin that third tone stands higher and darker, and the shadow goes deeper, so a face is carved
    // rather than lit from the front. Dark skin reads by its lights instead, and a soft face stays gentle.
    float kf = dot(nf, key), wb = max(fwidth(kf) * 0.75, 0.012), hardF = flesh ? (1.0 - uFaceV.w) * (1.0 - 0.85 * dkS) : 0.0, tk = mix(0.24, 0.44, hardF);
    c *= 1.0 - mix(0.13, 0.3, hardF) * lit * (1.0 - smoothstep(tk - wb, tk + wb, kf));
    if (flesh) c *= mix(vec3(1.0), mix(vec3(0.8, 0.72, 0.74), vec3(0.62, 0.56, 0.57), hardF), 1.0 - lit);
    // ink hatching across the deep shadow on skin, gone before the strokes would turn to grey
    if (flesh) {
      float hc = (vRest.y + vRest.x * 0.8) / 0.0046, fw = fwidth(hc);
      float hatch = (1.0 - smoothstep(0.28, 0.36, abs(fract(hc) - 0.5))) * (1.0 - smoothstep(0.25, 0.5, fw));
      c = mix(c, c * 0.66, (1.0 - max(uFaceV.w, 0.6 * uSmile)) * 0.5 * hatch * (1.0 - lit) * smoothstep(-0.03, -0.16, kf));
    }
    // dark skin reads by its lights, not its shadows: a hard plane of light where the form faces the key
    if (flesh) c += base * dFull * mix(0.55, 0.3, uFaceV.w) * dkS * lit * smoothstep(0.5, mix(0.56, 0.72, uFaceV.w), dot(normalize(n + nf), key));
    if (s != ${FIG_SLOT.hair} && !scalp) c += base * dFull * (0.24 + 0.5 * (flesh ? dkS : 0.0)) * lit * smoothstep(0.58, 0.82, 1.0 - max(dot(n, v), 0.0));
  }
  if (mat == 3.0 || mat == 4.0 || mat == 6.0) c += step(0.35, dot(spec, vec3(0.333))) * lit * (mat == 6.0 ? base * 1.6 + 0.2 : vec3(0.75));
  // the line always darker than the cloth it is drawn on: the house ink, or a third of a dark cloth
  c = mix(c, min(uLine, c * 0.32), 0.85 * ink);
  if (eyeHole) discard;
  outColor = vec4(finish(c), 1.0);
}`;

// The ink: ink.js's INK_VS with the skinning in front (as gl/ballpark.js SKIN_INK_VS), and set
// behind the body by uBack metres along the eye's ray rather than by a constant in clip space. A
// clip-space bias is a world depth that shrinks with the square of the distance: the room's
// 0.0004 is centimetres on a wall across the room and 3 mm on a face at arm's length, less than
// a grazing cheek falls away across the line's few pixels, and the ink came through the cheek.
const INK_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
${SKIN_VS_GLSL}
uniform mat4 uVP;
uniform vec2 uRes;
uniform vec4 uInk;
uniform vec3 uKey; uniform float uWeigh;
layout(location = 2) in vec2 aUv;
layout(location = 5) in float aSlot;
uniform vec3 uEyeI; uniform float uBack; uniform float uInkK;
void main() {
  vec3 p = skinAll(vec4(faceLift(mouthMorph(aPos, aSlot, aUv), aSlot), 1.0)), sn = skinAll(vec4(aNor, 0.0));
  // an eye and its lids take no outline: the lids' dark undersides are its line
  if (aSlot > ${FIG_SLOT.eye}.0 - 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  p += normalize(p - uEyeI) * uBack;
  float nl = dot(sn, sn);
  vec4 c = uVP * vec4(p, 1.0);
  if (nl < 0.01 || c.w <= 0.0) { c.z += uInk.w * max(c.w, 0.0); gl_Position = c; return; }
  vec3 n = sn * inversesqrt(nl);
  vec4 cn = uVP * vec4(p + n * uInk.x, 1.0);
  vec2 d = (cn.xy / max(cn.w, 1e-3) - c.xy / c.w) * uRes * 0.5;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(0.0);
  float wk = mix(max(uWeigh, 1.0), 1.0, smoothstep(-0.5, 0.7, dot(n, uKey)));
  c.xy += dir * clamp(L, uInk.y, uInk.z) * wk * uInkK / (uRes * 0.5) * c.w;
  c.z += uInk.w * c.w;
  gl_Position = c;
}`;
const INK_FS = `#version 300 es
precision highp float;
uniform vec3 uCol;
out vec4 outColor;
void main() { outColor = vec4(uCol, 1.0); }`;
declareProgram(VS, FS);
declareProgram(INK_VS, INK_FS);

// The layer for one GL context. `light(prog)` sets the room's light uniforms on a program (room.js
// does it for its own); `draw(vp, recs, light)` draws them lit; `ink(vp, recs, set)` draws their
// outline with uniforms `set` puts on the ink program.
export function createFigureLayer(gl, { half = false } = {}) {
  const prog = (vs, fs, label) => { const p = layerProgram(gl, vs, fs, label), u = {}; return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) }; };
  const LIT = prog(VS, FS, 'figure lit'), INK = prog(INK_VS, INK_FS, 'figure ink');
  const meshes = new Map();
  function meshOf(key) {
    const k = figureKey(key);
    let m = meshes.get(k);
    if (m) return m;
    const F = buildFigure(key);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = (data, loc, size, type = gl.FLOAT, normalized = false) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
      return b;
    };
    const bufs = [buf(F.P, 0, 3), buf(F.N, 1, 3), buf(F.UV, 2, 2), buf(F.B, 3, 4, gl.UNSIGNED_BYTE), buf(F.W, 4, 4), buf(new Float32Array(F.S), 5, 1), buf(F.A, 6, 1), buf(F.NF || F.N, 7, 3)];
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, F.I, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const cards = F.cards || { start: F.I.length, count: 0 };
    m = { vao, bufs, ib, n: F.I.length, cards, opaque: cards.count ? cards.start : F.I.length, nt: F.nt };
    meshes.set(k, m);
    return m;
  }
  const keyOf = (r) => r.key;

  // the face atlas, with a one-texel stand-in (plain skin) until it has loaded
  const atlas = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([170, 0, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const feed = createFaceAtlasFeed({ half, ink: true });
  function pollAtlas() {
    let img = null;
    try { img = feed.poll(); } catch { img = null; }
    if (!img) return;
    // ⚠ FLIPPED, NOT PREMULTIPLIED AND NOT COLOUR-CONVERTED: the four channels are masks
    // (actor-faces.js), as gl/actors.js uploads them
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, FACE_ATLAS.maxLevel - (half ? 1 : 0));
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } catch { /* the stand-in stays */ }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  let tris = 0;
  return {
    get tris() { return tris; },
    // build a mesh ahead of its first draw (it takes some tens of milliseconds)
    prepare(key) { meshOf(key); },
    ink(vp, recs, set) {
      if (!recs.length) return;
      gl.useProgram(INK.p);
      gl.uniformMatrix4fv(INK.u('uVP'), false, vp);
      set(INK);
      for (const r of recs) {
        const m = meshOf(keyOf(r));
        gl.uniform4fv(INK.u('uBone'), r.rows);
        gl.uniform3fv(INK.u('uMouthA'), r.mouthA || [0, 0, 0]);
        gl.uniform1f(INK.u('uBlink'), r.blink || 0);
        gl.uniform1f(INK.u('uFaceUp'), r.faceUp || 0);
        // the sculpted figure's forms and paint carry the drawing, so its outline is lighter
        gl.uniform1f(INK.u('uInkK'), r.key.sculpt ? 0.5 : 1);
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.opaque, gl.UNSIGNED_SHORT, 0);
      }
      gl.bindVertexArray(null);
    },
    draw(vp, recs, light) {
      tris = 0;
      if (!recs.length) return;
      pollAtlas();
      gl.useProgram(LIT.p);
      gl.uniformMatrix4fv(LIT.u('uVP'), false, vp);
      light(LIT);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.uniform1i(LIT.u('uAtlas'), 1);
      gl.uniform3fv(LIT.u('uShade'), HOUSE.shade);
      gl.uniform3fv(LIT.u('uLine'), HOUSE.ink);
      for (const r of recs) {
        const m = meshOf(keyOf(r));
        gl.uniform4fv(LIT.u('uBone'), r.rows);
        gl.uniform3fv(LIT.u('uCol'), r.col);
        gl.uniform1fv(LIT.u('uSurf'), r.surf);
        gl.uniform4fv(LIT.u('uFace'), r.face);
        gl.uniform3fv(LIT.u('uLip'), r.lip);
        gl.uniform3fv(LIT.u('uLipstick'), r.lipstick);
        gl.uniform3fv(LIT.u('uIris'), r.iris);
        gl.uniform1i(LIT.u('uCut'), Math.max(0, FIGURE_CUT_NAMES.indexOf(r.key.cut)));
        const C = FIGURE_CUTS[r.key.cut] || FIGURE_CUTS.coat;
        gl.uniform4f(LIT.u('uCutY'), C.top.hem, C.sleeve ? C.sleeve.cuff : 1.5, r.key.gear?.pads ? 1 : 0, r.gloves ? 1 : 0);
        gl.uniform4f(LIT.u('uCutF'), FRONT_KIND[C.front] || 0, C.rib || 0, C.quilt ? 1 : 0, C.vent ? 1 : 0);
        gl.uniform1f(LIT.u('uMantleHem'), C.mantle ? C.mantle.hem : 0);
        gl.uniform4f(LIT.u('uWild'), r.wild ? 1 : 0, r.mark ?? 0, r.key.body?.thorn ? 1 : 0, r.face[3] || 0);
        gl.uniform3fv(LIT.u('uMark'), r.markCol || [0.3, 0.3, 0.3]);
        gl.uniform3fv(LIT.u('uWrap'), r.wrapCol || [0.4, 0.35, 0.25]);
        gl.uniform3fv(LIT.u('uGlove'), r.glove || [0.03, 0.025, 0.02]);
        gl.uniform1f(LIT.u('uSculpt'), r.key.sculpt ? 1 : 0);
        gl.uniform4fv(LIT.u('uFaceV'), r.faceV || [1, 1, 0.8, 0]);
        gl.uniform1f(LIT.u('uAge'), r.age || 0);
        gl.uniform1f(LIT.u('uSmile'), r.smile || 0);
        gl.uniform3fv(LIT.u('uMouthA'), r.mouthA || [0, 0, 0]);
        gl.uniform3fv(LIT.u('uMouthB'), r.mouthB || [0, 0, 0]);
        gl.uniform1f(LIT.u('uBlink'), r.blink || 0);
        gl.uniform1f(LIT.u('uFaceUp'), r.faceUp || 0);
        gl.uniform1f(LIT.u('uRealEye'), r.realEye ? 1 : 0);
        gl.uniform2fv(LIT.u('uGaze'), r.gaze || [0, 0]);
        gl.uniform4fv(LIT.u('uBeardA'), r.beardA || [0, 0, 0, 0]);
        gl.uniform3fv(LIT.u('uBeardB'), r.beardB || [0, 0, 0]);
        const So = r.key.sculpt && r.key.weight !== null && r.key.weight !== undefined ? somaOf(r.key.weight) : null;
        gl.uniform3f(LIT.u('uSoma'), So ? Math.max(0, Math.min(1, (So.muscle - 0.55) / 1.15)) : 0, So ? So.ribs : 0, So ? So.fat : 0);
        gl.uniform3fv(LIT.u('uTrim'), r.trim || [0.02, 0.02, 0.02]);
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
        tris += m.nt;
      }
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose() {
      for (const m of meshes.values()) { gl.deleteVertexArray(m.vao); for (const b of m.bufs) gl.deleteBuffer(b); gl.deleteBuffer(m.ib); }
      meshes.clear();
      gl.deleteTexture(atlas);
    },
  };
}
