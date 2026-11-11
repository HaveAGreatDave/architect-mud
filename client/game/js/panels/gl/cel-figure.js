// GLASS 2 · THE FIGURE CEL: how a person is cel-shaded, once, in GLSL and in JS.
//
// The ballpark's players (gl/ballpark.js), the angler on the skiff (glass/rod-rig.js) and, with the
// comic look on, the rink's skaters (gl/arena.js, celKey) read this, so they look like one style,
// and like the kitchen's cook (gl/kitchen.js) whose numbers these are: light in CEL.bands hard
// steps, a cool shadow tone where the light doesn't reach, a hard rim on the lit edge, and a dark
// ink line round the body. The comic look swaps the bands and the shade for gl/house-style.js's.
//
// ⚠ ONE SWITCH. CEL_TUNE.on turns the look off for an A/B, and CEL_TUNE.ink the outline alone (it's
// a second draw of every body, so a phone tier can drop it). Both readers check these at draw time.
//
// ⚠ THE GPU AND THE CPU STEP DIFFERENTLY ON PURPOSE. A shader bands per pixel and softens each edge
// to a pixel (toon.js toonBands); a figure shaded per face on the CPU has one value a face, so its
// twin, celLightJS, rounds to the step outright. Both land on the same steps.
//
// Units: the ink's world width is in feet, the rig's unit (diamond/rig.js) and the rink's.

import { TOON_GLSL } from './toon.js';
import { COMIC_LIGHT_GLSL } from './comic-light.js';

export const CEL_TUNE = { on: 1, ink: 1 };

export const CEL = {
  bands: 3,                       // hard steps of light, as the kitchen and the city have
  shade: [0.6, 0.62, 0.8],        // what the unlit side is multiplied by: a cool blue-grey (kitchen.js SHADE)
  rimEdge: 0.84,                  // how far round to the silhouette the rim starts, in 1 - n.v
  rimMin: 0.2,                    // the rim only shows where at least this much light falls
  rimLift: 0.16,                  // how much brighter the rim is, as a share of the colour
  ink: [0.045, 0.045, 0.055],     // the line's colour (between arena.js's and kitchen.js's)
  inkFt: 0.035,                   // the line's world width round a man: a hairline, not a marker
  inkPx: [0.8, 1.5],              // held between these many pixels of a 900-wide picture
  inkBias: 0.0006,                // how far behind the body the ink sits, in clip depth
  inkBack: 0.3,                   // the same in feet, for a view that sets uBack (the ballpark)
  inkHeadBack: 2,                 // a head's, as a multiple of inkBack: the nose stands out further
};

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/**
 * celLight, celTone and celRim, after toon.js's toonBands and toonStep, and celInk, the comic look's
 * lines. Only behind a uniform branch.
 *
 * The bands, the shade and the comic switch are uniforms, set from gl/house-style.js
 * figureLightOf at draw time: uCelBands and uCelShade are CEL.bands and CEL.shade unless the comic
 * look is on (docs/proposals/comic-ink.md). A program that includes this and draws with uCel must
 * set all three, or its shade side is black.
 */
export const CEL_GLSL = `${TOON_GLSL}
uniform float uCelBands; uniform vec3 uCelShade; uniform float uCelComic;
${COMIC_LIGHT_GLSL}
float celLight(float d, float bands) { return toonBands(min(d * 1.15, 0.999), bands); }
vec3 celTone(vec3 rgb, float lit) { return mix(rgb * uCelShade, rgb, lit); }
float celRim(vec3 n, vec3 v, float lit) {
  return toonStep(${f(CEL.rimEdge)}, 1.0 - max(dot(n, v), 0.0)) * toonStep(${f(CEL.rimMin)}, lit) * ${f(CEL.rimLift)} * (1.0 - uCelComic);
}
// The comic look's ink over a lit figure, 0..1: a line where the light steps (its banded value
// changes fast across the pixel, at every band edge and every hard shadow's edge), and hatching in
// full shadow where the surface turns away from its brightest light, laid along B, a point in the
// figure's own bind space, so the strokes ride the body instead of swimming over it. keyD is
// N.L for that light: the hatching starts as it passes -0.15 and is full by -0.6, so a figure lit
// from behind has hatching down his flanks, not all over his front. gap is the stroke spacing in
// B's units. Strokes closer than about two pixels fade out rather than shimmer. 0 unless uCelComic.
float celInk(float lit, float keyD, vec3 B, float gap) {
  float edge = smoothstep(0.2, 0.55, fwidth(lit));
  float s = dot(B, vec3(0.7071, 0.7071, 0.0)) / gap, fs = fwidth(s);
  float dark = (1.0 - smoothstep(0.02, 0.12, lit)) * smoothstep(-0.15, -0.6, keyD);
  float hatch = (1.0 - smoothstep(0.03 + 0.06 * dark, 0.09 + 0.06 * dark + fs, abs(fract(s) - 0.5))) * step(0.01, dark) * (1.0 - smoothstep(0.25, 0.5, fs));
  return clamp(max(edge * 0.75, hatch * 0.6), 0.0, 1.0) * uCelComic;
}
// A figure under one key light, the way the rink lights its men (gl/arena.js, gl/arena-heads.js):
// rgb in the banded light over the painted shade, a hard highlight on the lit side worth specK, and
// celInk's line and hatching over it in ink. N and V face each other; B and gap are celInk's.
// With the comic look on it's the comic light (gl/comic-light.js comicKey) instead: one terminator
// a little past side-on, a lighter shadow with its core and bounce, and no line or hatching inside
// the figure; its outline is the ink pass's.
vec3 celKey(vec3 rgb, vec3 N, vec3 V, vec3 L, float specK, vec3 B, float gap, vec3 ink) {
  if (uCelComic > 0.5) return comicKey(rgb, N, V, L, specK, uCelShade);
  float keyD = dot(N, L), lit = celLight(max(keyD, 0.0), uCelBands);
  float hi = toonStep(0.5, pow(max(dot(N, normalize(L + V)), 0.0), 32.0)) * specK * step(0.01, lit);
  return mix(celTone(rgb, lit) + vec3(hi), ink, celInk(lit, keyD, B, gap));
}
`;

/** The banded light for one face, 0..1: the same steps as celLight, rounded outright. */
export function celLightJS(d, bands = CEL.bands) {
  const y = Math.min(Math.max(d, 0) * 1.15, 0.999) * bands;
  return Math.floor(y + 0.5) / bands;
}

/** One face's colour channel: the shadow tone mixed to full colour by the banded light, plus the rim. */
export function celToneJS(c, ch, lit, rim = 0, shade = CEL.shade) {
  return (c * shade[ch] + (c - c * shade[ch]) * lit) * (1 + rim);
}

/** The rim for one face: 1 - n.v is how side-on it is to the eye. */
export function celRimJS(sideOn, lit) {
  return sideOn >= CEL.rimEdge && lit >= CEL.rimMin ? CEL.rimLift : 0;
}
