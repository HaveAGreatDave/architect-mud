// GLASS 2 · THE FIGURE CEL: how a person is cel-shaded, once, in GLSL and in JS.
//
// The ballpark's players (gl/ballpark.js) and the angler on the skiff (glass/rod-rig.js) read this,
// so they look like one style, and like the rink's skaters (gl/arena.js) and the kitchen's cook
// (gl/kitchen.js) whose numbers these are: light in CEL.bands hard steps, a cool shadow tone where
// the light doesn't reach, a hard rim on the lit edge, and a dark ink line round the body.
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

export const CEL_TUNE = { on: 1, ink: 1 };

export const CEL = {
  bands: 3,                       // hard steps of light, as the kitchen and the city have
  shade: [0.6, 0.62, 0.8],        // what the unlit side is multiplied by: a cool blue-grey (kitchen.js SHADE)
  rimEdge: 0.68,                  // how far round to the silhouette the rim starts, in 1 - n.v
  rimMin: 0.2,                    // the rim only shows where at least this much light falls
  rimLift: 0.16,                  // how much brighter the rim is, as a share of the colour
  ink: [0.045, 0.045, 0.055],     // the line's colour (between arena.js's and kitchen.js's)
  inkFt: 0.09,                    // the line's world width round a man (arena.js uInk.x)
  inkPx: [1.2, 3.6],              // held between these many pixels of a 900-wide picture
  inkBias: 0.0006,                // how far behind the body the ink sits, in clip depth
};

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const v3 = (a) => `vec3(${a.map(f).join(', ')})`;

/** celLight, celTone and celRim, after toon.js's toonBands and toonStep. Only behind a uniform branch. */
export const CEL_GLSL = `${TOON_GLSL}
const vec3 CEL_SHADE = ${v3(CEL.shade)};
float celLight(float d, float bands) { return toonBands(min(d * 1.15, 0.999), bands); }
vec3 celTone(vec3 rgb, float lit) { return mix(rgb * CEL_SHADE, rgb, lit); }
float celRim(vec3 n, vec3 v, float lit) {
  return toonStep(${f(CEL.rimEdge)}, 1.0 - max(dot(n, v), 0.0)) * toonStep(${f(CEL.rimMin)}, lit) * ${f(CEL.rimLift)};
}
`;

/** The banded light for one face, 0..1: the same steps as celLight, rounded outright. */
export function celLightJS(d, bands = CEL.bands) {
  const y = Math.min(Math.max(d, 0) * 1.15, 0.999) * bands;
  return Math.floor(y + 0.5) / bands;
}

/** One face's colour channel: the shadow tone mixed to full colour by the banded light, plus the rim. */
export function celToneJS(c, ch, lit, rim = 0) {
  return (c * CEL.shade[ch] + (c - c * CEL.shade[ch]) * lit) * (1 + rim);
}

/** The rim for one face: 1 - n.v is how side-on it is to the eye. */
export function celRimJS(sideOn, lit) {
  return sideOn >= CEL.rimEdge && lit >= CEL.rimMin ? CEL.rimLift : 0;
}
