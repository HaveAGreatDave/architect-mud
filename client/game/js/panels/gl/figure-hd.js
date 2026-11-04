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

import { buildFigure, figureKey, FIG_SLOT, FIG_PIECE, FIGURE_BONES, FIGURE_CUT_NAMES, FIGURE_CUTS } from '../figure.js';
import { FACE_GLSL, FACE_ATLAS } from '../actor-faces.js';
import { FACE, HAIRLINE_GLSL } from '../actor-head.js';
import { createFaceAtlasFeed } from './face-atlas.js';
import { declareProgram, layerProgram } from './programs.js';
import { ROOM_LIGHT_GLSL } from './room-light.js';
import { HOUSE } from './house-style.js';

export const FIG_BONE_ROWS = FIGURE_BONES.length * 12;
// how a cut's front is painted (FIGURE_CUTS front), as uCutF.x
const FRONT_KIND = { buttons: 1, zip: 2, pocket: 3, vest: 4, tunic: 5 };
const NB = FIGURE_BONES.length * 3;
const f4 = (v) => v.toFixed(4);

const SKIN_VS_GLSL = `
layout(location = 3) in vec4 aBones;
layout(location = 4) in vec4 aWeights;
uniform vec4 uBone[${NB}];
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
out vec3 vPos; out vec3 vNor; out vec3 vNorF; out vec3 vRest; out vec2 vUv; out float vAux; flat out float vSlot;
void main() {
  vec3 p = skinAll(vec4(aPos, 1.0));
  vPos = p; vNor = skinAll(vec4(aNor, 0.0)); vNorF = skinAll(vec4(aNorF, 0.0)); vRest = aPos; vUv = aUv; vAux = aAux; vSlot = aSlot;
  gl_Position = uVP * vec4(p, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec3 vNorF; in vec3 vRest; in vec2 vUv; in float vAux; flat in float vSlot;
uniform vec3 uCol[18];
uniform float uSurf[18];
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
      if (uCutF.z > 0.5 && r.y > hem + uCutF.y) {
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
      float vx = max(0.0, (1.455 - r.y) * 0.3);
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
    if (uCut == 4 && r.x > 0.0 && lat > 0.02) { float d = length(vec2(r.z + 0.005, r.y - 1.3)); base = mix(base, uCol[${FIG_SLOT.legs}] * 1.2, 1.0 - smoothstep(0.02, 0.021, d)); ink = max(ink, inkL(d - 0.02, W)); }
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
    if (uCutY.z < 0.5) ink = max(ink, step(0.02, r.z) * max(inkL(r.y - 0.462, W), inkL(r.y - 0.578, W)));
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
  if (s == ${FIG_SLOT.face}) {
    vec3 r = vRest;
    float lay = uFace.x;
    vec4 cell = vec4(mod(lay, ${FACE_ATLAS.cols}.0) / ${FACE_ATLAS.cols}.0, (${FACE_ATLAS.rows - 1}.0 - floor(lay / ${FACE_ATLAS.cols}.0 + 0.001)) / ${FACE_ATLAS.rows}.0,
      1.0 / ${FACE_ATLAS.cols}.0, 1.0 / ${FACE_ATLAS.rows}.0);
    vec2 uv = clamp((r.xy - vec2(${f4(FACE.x0)}, ${f4(FACE.y0)})) / vec2(${f4(FACE.x1 - FACE.x0)}, ${f4(FACE.y1 - FACE.y0)}), 0.0, 1.0);
    vec4 m = texture(uAtlas, cell.xy + uv * cell.zw);
    float wet;
    base = faceColour(m, r, skin, hair, uLip, uLipstick, uFace.y, uIris, wet);
    if (wet > 0.25) mat = 4.0;
    // the scalp under the hair's edge, the hair's colour
    float hl = hairlineAt(r);
    base = mix(base, hair * 0.9, smoothstep(hl - 0.0025, hl + 0.0025, r.y));
    base *= 1.0 - 0.18 * smoothstep(1.534, 1.522, r.y);
  } else if (s == ${FIG_SLOT.ear}) {
    base = skin * vec3(1.03, 0.94, 0.92) * (1.0 - 0.3 * vAux);
  } else if (s == ${FIG_SLOT.neck}) {
    // the jaw's shadow on the throat
    base = skin * (1.0 - 0.3 * smoothstep(1.49, 1.535, vRest.y) * smoothstep(-0.02, 0.025, vRest.z));
  } else if (s == ${FIG_SLOT.hair}) {
    base = hair * (0.82 + 0.2 * hh(floor(atan(vRest.x, vRest.z) * 40.0) + uFace.w));
  }
  float ink = 0.0;
  int piece = int(vAux + 0.5);
  if (s == ${FIG_SLOT.top} || s == ${FIG_SLOT.legs} || s == ${FIG_SLOT.shoes} || s == ${FIG_SLOT.collar} || s == ${FIG_SLOT.gear} || s == ${FIG_SLOT.pad} || s == ${FIG_SLOT.cloak} || s == ${FIG_SLOT.shirt})
    ink = paintCloth(s == ${FIG_SLOT.shirt} ? ${FIG_SLOT.top} : s, piece, vRest, base, mat);
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
  vec3 key = normalize((lampOn ? uLampP : uWinP) - vPos);
  vec3 dFull, sFull, diff, spec;
  roomLight(vPos, key, v, mat, dFull, sFull);
  roomLight(vPos, n, v, mat, diff, spec);
  float lit;
  vec3 c = comicTone(base, nf, n, v, key, dFull, uAmb, uShade, lit);
  if (mat == 3.0 || mat == 4.0 || mat == 6.0) c += step(0.35, dot(spec, vec3(0.333))) * lit * (mat == 6.0 ? base * 1.6 + 0.2 : vec3(0.75));
  // the line always darker than the cloth it is drawn on: the house ink, or a third of a dark cloth
  c = mix(c, min(uLine, c * 0.32), 0.85 * ink);
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
uniform vec3 uEyeI; uniform float uBack;
void main() {
  vec3 p = skinAll(vec4(aPos, 1.0)), sn = skinAll(vec4(aNor, 0.0));
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
  c.xy += dir * clamp(L, uInk.y, uInk.z) * wk / (uRes * 0.5) * c.w;
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
