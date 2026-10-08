// THE STREET FIGURE'S FACE: A BAKED ATLAS OF MASKS, TINTED PER PERSON.
//
// No face is painted at runtime. 32 layouts are painted once, as masks rather than colours, into one
// atlas (client/game/assets/actor-faces.png, baked by scripts/shapes/actor-faces.mjs --write from the
// painter in tools/modelshop/face-masks.mjs), and the shader colours a layout with the person's own
// skin, hair, lips and eyes. So the variety is layouts times colours, and a face costs one texture
// fetch. docs/proposals/street-figure-heads.md is the plan this is phase 3 of.
//
// A texel is four masks:
//   R  shade, a multiplier on everything (1.5 x R): the sockets, the shadows under the nose and lip,
//      folds and lines, nostrils, the lash line, the mouth line, and each hair's own brightness.
//   G  hair: brows, stubble and beard, coloured with the person's hair.
//   B  lips: 0.5 and over is the lip, coloured with the lip (or the layout's lipstick); under 0.5
//      it's a flush of the same colour, on the cheeks, the nose and the inner corners of the eyes.
//   A  1 - the eye's opening. The white, the iris, the pupil and the catchlight are drawn by the
//      shader from where the point is on the head, since the eyes are in the same place in every
//      layout, so any iris colour fits any layout and the iris stays round at every size.
// A is 1 everywhere but the eyes, so a texel of plain skin is opaque.
//
// The atlas is 8 x 4 cells of 256 x 320, each a front projection of FACE's box (actor-head.js),
// with row 0 at the top as a PNG reads. Upload it with UNPACK_FLIP_Y_WEBGL on and premultiplying
// off; the cells are stacked on 64-texel boundaries, so mips 0 to 6 never mix two faces
// (TEXTURE_MAX_LEVEL 6).
//
// Which face somebody gets comes off their actor token, never the NPC, like their outfit (see
// ACTOR_OUTFITS in actor3d.js): a face drawn from who they are would be an identity readable from a
// street away.
import { FACE } from './actor-head.js';

export const FACE_ATLAS = { cols: 8, rows: 4, cellW: 256, cellH: 320, w: 2048, h: 1280, maxLevel: 6,
  src: 'assets/actor-faces.png', half: 'assets/actor-faces-half.png' };

// The layouts: [age 0..1, beard (0 none, 1 stubble, 2 full), makeup, mood (-1 frown .. 1 smile),
// brow (-1 stern .. 1 worried)]. Age greys the hair (faceHair) as well as lining the face, so a
// young face never gets white hair from the colour pick. Seven stubble, five beards, seven with
// makeup, and never a beard with makeup.
export const FACE_LAYOUTS = [
  [0.15, 0, 0, 0.3, 0], [0.25, 0, 1, 0.2, -0.2], [0.35, 1, 0, -0.2, -0.5], [0.5, 2, 0, 0, -0.3],
  [0.7, 0, 0, -0.3, 0.4], [0.2, 0, 1, 0.5, 0.1], [0.85, 1, 0, -0.1, 0.2], [0.4, 0, 0, 0.1, -0.6],
  [0.1, 0, 0, 0.6, 0.3], [0.55, 2, 0, 0.2, -0.1], [0.3, 0, 1, -0.2, -0.3], [0.65, 0, 0, 0, 0.6],
  [0.45, 1, 0, 0.4, -0.2], [0.2, 0, 0, -0.4, 0], [0.9, 0, 0, 0.2, -0.4], [0.35, 0, 1, 0, 0.4],
  [0.6, 1, 0, -0.5, -0.6], [0.15, 0, 0, 0.1, -0.3], [0.75, 2, 0, 0.3, 0.1], [0.5, 0, 1, 0.3, -0.1],
  [0.25, 2, 0, -0.1, 0.3], [0.8, 0, 0, 0.5, 0], [0.4, 1, 0, 0, 0.5], [0.3, 0, 0, 0.2, 0.2],
  [0.12, 0, 1, 0.4, -0.4], [0.7, 1, 0, 0.1, -0.2], [0.55, 0, 0, -0.3, -0.5], [0.95, 2, 0, -0.2, 0.3],
  [0.2, 1, 0, 0.6, 0], [0.45, 0, 1, -0.1, 0.2], [0.65, 0, 0, 0.3, -0.1], [0.3, 0, 0, -0.6, 0.1],
].map(([age, beard, makeup, mood, brow], i) => ({ age, beard, makeup, mood, brow, seed: i * 7919 + 101 }));

// A layout's cell in the atlas, as [u0, v0, du, dv] in texture coordinates after a flipped upload:
// a face UV (u, v) in 0..1 is at (u0 + u * du, v0 + v * dv).
export function faceCell(i) {
  const c = i % FACE_ATLAS.cols, r = Math.floor(i / FACE_ATLAS.cols);
  return [c / FACE_ATLAS.cols, (FACE_ATLAS.rows - 1 - r) / FACE_ATLAS.rows, 1 / FACE_ATLAS.cols, 1 / FACE_ATLAS.rows];
}

// ── Colours, from the token ─────────────────────────────────────────────────────────────────────────
// 0..255 sRGB, by weight, the way ACTOR_OUTFITS is.
export const FACE_COLOURS = {
  iris: [
    [[56, 38, 26], 4], [[84, 56, 34], 3], [[38, 30, 26], 2], [[108, 86, 48], 1.5], [[70, 96, 132], 1.5],
    [[96, 108, 118], 1], [[74, 96, 60], 1],
  ],
  lipstick: [[[150, 40, 50], 2], [[110, 50, 120], 1], [[90, 30, 60], 1], [[172, 84, 82], 1.5], [[118, 62, 50], 1]],
  // Hair styles as actor-head.js numbers them: cropped, neat and parted, tousled, long, a quiff.
  hairStyle: [[0, 3], [1, 3], [2, 2], [3, 2], [4, 1]],
};
// Their slots in rand(k): clear of actorOutfit's 0-4 and 10-12, and of the 6-9 windshield.js hashes.
const FACE_K = { layout: 13, iris: 14, lipstick: 15, hairStyle: 16 };
function pick(list, r) {
  let total = 0;
  for (const [, w] of list) total += w;
  let x = r * total;
  for (const [c, w] of list) { if ((x -= w) < 0) return c; }
  return list[list.length - 1][0];
}
// `rand(k)` is the same stable 0..1 per index that actorOutfit takes. Returns { layout, iris,
// lipstick, hairStyle }: a layout index, two colours and a hair style.
export function actorFace(rand) {
  return {
    layout: Math.min(FACE_LAYOUTS.length - 1, Math.floor(rand(FACE_K.layout) * FACE_LAYOUTS.length)),
    iris: pick(FACE_COLOURS.iris, rand(FACE_K.iris)),
    lipstick: pick(FACE_COLOURS.lipstick, rand(FACE_K.lipstick)),
    hairStyle: pick(FACE_COLOURS.hairStyle, rand(FACE_K.hairStyle)),
  };
}
// The hair's colour with the layout's age in it: grey from 0.6 and two-thirds of the way at 1.
export function faceHair(hair, layout) {
  const g = Math.max(0, Math.min(1, (FACE_LAYOUTS[layout].age - 0.6) / 0.4)), grey = g * g * (3 - 2 * g) * 0.7;
  return hair.map((c) => c + (153 - c) * grey);
}
// The lips' own colour, from the skin: redder on pale skin, deeper on dark.
export function faceLip(skin) {
  const k = Math.max(0, Math.min(1, (120 - skin[0]) / 120)) * 0.5;
  return [0.86, 0.55, 0.55].map((m, i) => skin[i] * m + (skin[i] * 0.72 - skin[i] * m) * k);
}

// ── The shader's half ───────────────────────────────────────────────────────────────────────────────
// faceColour(m, r, ...): `m` is the atlas texel, `r` the point on the head in metres (bind space),
// and the colours are in whatever space the caller lights in, as long as they all are. `makeup` is
// the layout's. Returns the face's colour; `wet` gets how shiny it is (the eyes, the lips).
const f4 = (v) => v.toFixed(4);
export const FACE_GLSL = `
vec3 faceColour(vec4 m, vec3 r, vec3 skin, vec3 hair, vec3 lip, vec3 lipstick, float makeup, vec3 iris, out float wet) {
  float lipK = smoothstep(0.5, 0.75, m.b);
  vec3 col = mix(skin, mix(lip, lipstick, makeup * lipK), m.b);
  col = mix(col, hair, m.g);
  float eye = 1.0 - m.a;
  if (eye > 0.002) {
    vec2 c = vec2(sign(r.x) * ${f4(FACE.irisX)}, ${f4(FACE.eyeY + 0.0003)});
    float d = distance(r.xy, c), aa = max(fwidth(d), 0.0002);
    // The white, darker toward the corners; the iris lighter round the pupil with a dark rim.
    vec3 e = mix(skin, vec3(0.91, 0.886, 0.855), 0.82) * (1.0 - 0.35 * smoothstep(0.004, 0.018, d));
    float t = d / ${f4(FACE.iris)};
    vec3 ir = iris * mix(mix(1.35, 1.1, smoothstep(0.0, 0.45, t)), mix(0.78, 0.35, smoothstep(0.85, 1.0, t)), smoothstep(0.45, 0.85, t));
    e = mix(e, ir, 1.0 - smoothstep(${f4(FACE.iris)} - aa, ${f4(FACE.iris)} + aa, d));
    e = mix(e, vec3(0.04), 1.0 - smoothstep(${f4(FACE.pupil)} - aa, ${f4(FACE.pupil)} + aa, d));
    // The upper lid's shadow across the top of the ball, then a catchlight, the same side in both.
    e = mix(e, vec3(0.08, 0.055, 0.047), 0.6 * smoothstep(${f4(FACE.eyeY - 0.0005)}, 1.6458, r.y));
    float cl = distance(r.xy, c + vec2(-0.0017, 0.0019));
    e = mix(e, vec3(1.0), 0.95 * (1.0 - smoothstep(0.0011 - aa, 0.0011 + aa, cl)));
    col = mix(col, e, eye);
  }
  wet = 0.5 * eye + 0.3 * lipK;
  return col * (m.r * 1.5);
}`;
