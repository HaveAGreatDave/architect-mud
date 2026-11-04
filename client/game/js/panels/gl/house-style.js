// GLASS 2 · THE HOUSE STYLE: the comic look's numbers, once, for every view.
//
// Every 3-D view draws its people and its city in its own cel look today: the park's players
// (gl/cel-figure.js), the rink's skaters (gl/arena.js), the kitchen (gl/kitchen.js), the angler
// (glass/rod-rig.js) and the city's mass (gl/context.js, RENDER_TUNE.glToon and glInk). Each has
// its own ink colour, its own line widths and its own bands. The comic look
// (docs/proposals/comic-ink.md) is one style for all of them, so its numbers live here and each view
// asks for them at draw time.
//
// ⚠ OFF, EVERY VIEW DRAWS EXACTLY AS IT DID. Every helper here hands back the view's own numbers
// unless the comic look is on, so adding a reader changes nothing until the setting does.
//
// The switch is Settings → Cel Shading → Comic (celShade 'comic' in client/shared/settings.js),
// applied by main.js `_applyCelShade`, which leaves `__houseComic` on the window. It's read on
// every call, so the next frame shows a change, and a view loaded later finds it already set.
//
// What reads what: every view takes the one ink (inkOf, cityInkCol). The park's players, the
// rink's skaters and the angler take the whole figure look (figureLightOf: two bands, the painted
// shade, the line along the light's edge, hatching, the weighted line); the kitchen takes its bands
// (bandsOf); the city takes its tune keys (cityTuneFor); the vehicles take two tones and the
// painted shade (vehicleLightOf). The park and the rink line their pictures
// off a depth (parkInkOf, rinkInkOf). Which views still fall short is in the doc's Coverage table.
//
// Pure: no DOM and no GL.

export const HOUSE = Object.freeze({
  ink: Object.freeze([0.05, 0.045, 0.055]),  // one ink, near black and a little warm
  bands: 2,                                  // light and shadow, nothing between
  widen: 2.5,                                // a figure's line, as a multiple of its view's own world width
  px: Object.freeze([1.8, 4.5]),             // ...held between these many pixels of a 900-wide picture
  cityPx: 2.5,                               // the city's outline, CSS px (RENDER_TUNE.glInkPx)
  cityFar: 30,                               // ...and the tiles it holds to (glInkFar)
  shade: Object.freeze([0.62, 0.52, 0.7]),   // a figure's unlit side: a painted warm violet, not a cool grey
  weigh: 1.7,                                // the line on a figure's side away from the light, times its width
  hatchFt: 0.07,                             // a figure's hatching: the gap between strokes, in feet of him
  parkPx: 2,                                 // the park's screen-pass lines, px of a 900-wide picture
  // ...where its lines fade, in feet: detail over the first two, outlines over the last two. The
  // detail lines (gl/ssao.js INK_FRAG's r) are off in the park: with the field in the depth, which
  // the city's never has, its one-texel taps read the grazing grass as creases in alternate rows,
  // and the jersey's placket groove as a black stripe. The players get their inner contours from
  // their own line, so only the outlines (g) are kept: the stands on the sky, the crowd and its
  // cards, a man against the field.
  parkFade: Object.freeze([-2, -1, 700, 1400]),
  parkInk: Object.freeze([0.07, 0.06, 0.07]),      // ...in the encoded picture, so near black on screen
});

/** Whether the comic look is on. Read every frame, so the setting lands on the next one. */
export const comicOn = () => !!globalThis.__houseComic;

/** A view's ink, in its own units: `own` is { ft, px: [min, max] of a 900-wide picture, col }. */
export function inkOf(own) {
  if (!comicOn()) return own;
  return { ft: own.ft * HOUSE.widen, px: HOUSE.px, col: HOUSE.ink };
}

/**
 * A figure's light, for a view that takes it as uniforms (gl/cel-figure.js CEL_GLSL): `own` is
 * { bands, shade }. Comic adds the edge line and the hatching, drops the rim, and weighs the line.
 */
export function figureLightOf(own) {
  if (!comicOn()) return { bands: own.bands, shade: own.shade, comic: 0, weigh: 1 };
  return { bands: HOUSE.bands, shade: HOUSE.shade, comic: 1, weigh: HOUSE.weigh };
}

/**
 * The park's screen-pass lines (gl/ballpark.js, gl/broadcast.js) for a picture `w` device pixels
 * wide: null unless the comic look is on, so off, nothing is drawn and no depth is kept for it.
 */
export function parkInkOf(w) {
  if (!comicOn()) return null;
  return { step: Math.max(1, HOUSE.parkPx * w / 900), fade: HOUSE.parkFade, col: HOUSE.parkInk };
}

/**
 * The rink's screen-pass lines (gl/arena.js) for a picture `w` device pixels wide: null unless the
 * comic look is on. The park's width; outlines only, as the park's; and the house ink as it is,
 * since the rink draws straight to the canvas with no grade after it.
 */
export function rinkInkOf(w) {
  if (!comicOn()) return null;
  return { step: Math.max(1, HOUSE.parkPx * w / 900), col: HOUSE.ink };
}

/**
 * The vehicles' light (gl/solids.js, docs/proposals/vehicle-comic.md V1): `comic` 0 unless the comic
 * look is on, and then the figures' painted shade for their shadow side. Off, a vehicle draws with
 * its own light, and the shade isn't read.
 */
export function vehicleLightOf() {
  return { comic: comicOn() ? 1 : 0, shade: HOUSE.shade };
}

/**
 * The own ship's edge lines (gl/vehicle-ink.js, V2) for a target `w` device pixels wide: null unless
 * the comic look is on. The outline at the city's width, the creases and part lines at half, never
 * under a pixel, and the figures' weight on the side away from the sun.
 */
export function vehicleInkOf(w) {
  if (!comicOn()) return null;
  const k = w / 900;
  return { sil: Math.max(1, HOUSE.cityPx * k), detail: Math.max(1, HOUSE.cityPx * 0.5 * k), weigh: HOUSE.weigh, col: HOUSE.ink };
}

/** A view's band count, where the view passes it as a uniform. */
export const bandsOf = (own) => (comicOn() ? HOUSE.bands : own);

/** The city's ink colour (gl/context.js INK_COL). */
export const cityInkCol = (own) => (comicOn() ? HOUSE.ink : own);

/**
 * The city's tune keys for a Cel Shading setting: 'off', 'on' (the city's cel look as it shipped)
 * or 'comic'. A boolean is read as off or on, the way the setting was passed before 'comic'.
 */
export function cityTuneFor(mode) {
  const m = mode === true ? 'on' : mode === 'on' || mode === 'comic' ? mode : 'off';
  const on = m === 'off' ? 0 : 1;
  return m === 'comic'
    ? { glToon: on, glInk: on, glToonBands: HOUSE.bands, glInkPx: HOUSE.cityPx, glInkFar: HOUSE.cityFar }
    : { glToon: on, glInk: on, glToonBands: 3, glInkPx: 1.5, glInkFar: 24 };
}
