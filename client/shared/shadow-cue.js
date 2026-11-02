// The aircraft's shadow as a height gauge. Two shadows read together: the sun's, cast away from
// the craft by its height, and a contact shadow straight under it that the sun doesn't need. On the
// way down the sun's shadow closes in under her, shrinks back to her own size, sharpens and darkens,
// while the contact shadow fades in tight and dark over the last stretch of the approach, so the
// flare has something to read before the wheels touch.
//
// `h` is the view's 0..1 height (flightHeight in flight-height.js: sqrt of altitude over 3000 ft),
// the same number the camera climbs on, so the shadow agrees with the height the craft is drawn at.
// windshield.js (drawAircraftShadow, drawGroundContactShadow) is the only reader; the shadow gate
// (scripts/shapes/shadow-cue.mjs) checks the curves.

// Where the contact shadow starts: h 0.15 is about 70 ft. Below it the shadow under her is the cue.
export const CONTACT_BAND_H = 0.15;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** The contact shadow under the craft at height h: strength 0..1, spread (a size multiplier) and softness 0..1. */
export function contactCue(h, onGround = false) {
  if (onGround) return { strength: 1, spread: 1, soft: 0.14 };
  const u = clamp(h / CONTACT_BAND_H, 0, 1);   // 0 on the deck, 1 at the top of the band
  const near = (1 - u) * (1 - u);
  return { strength: near, spread: 1 + 0.55 * u, soft: 0.14 + 0.6 * u };
}

/** The sun's shadow at height h: reach in tiles per unit of 1/elevation, size, alpha multiplier and softness. */
export function sunCue(h) {
  const a = clamp(h, 0, 1);
  const near = (1 - clamp(a / CONTACT_BAND_H, 0, 1)) ** 2;   // 1 on the deck, 0 above the contact band
  return {
    reach: a * 10,                          // the cast point, as the camera's climb draws her
    scale: 1 - a * 0.4,                     // a shadow from high up spreads past its own outline
    alpha: (1 - a * 0.55) * (1 + 0.3 * near),   // darkens on the way down, most over the last 70 ft
    soft: clamp(0.04 + a * 1.1, 0, 1),      // crisp near the deck, a diffuse smear from altitude
    alphaCap: 0.4 + 0.12 * near,
  };
}
