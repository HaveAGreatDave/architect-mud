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
// What step 1 covers: one ink colour, heavier lines round every figure, two bands where a view's
// band count is a uniform, and the city's cel look switched on with the same numbers. The painted
// shadow, the line along the light's edge, hatching, the weighted line and the inked kits and faces
// are later steps; a view whose bands are compiled into its shader (the park's players) keeps them.
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
