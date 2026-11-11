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
  rinkLinePx: 1,                             // the rink's screen-pass lines: they lie on top of a man's own line, so they stay thin
  cityPx: 2.5,                               // the city's outline, CSS px (RENDER_TUNE.glInkPx)
  vehiclePx: 1.7,                            // the own ship's outline (vehicleInkOf), a touch under the city's so a plane isn't heavy
  cityFar: 30,                              // ...and the tiles it holds to (glInkFar)
  shade: Object.freeze([0.62, 0.52, 0.7]),   // a figure's unlit side: a painted warm violet, not a cool grey
  weigh: 1.7,                                // the line on a figure's side away from the light, times its width
  hatchFt: 0.07,                             // a figure's hatching: the gap between strokes, in feet of him
  // The park's players are small in most shots, so the house line would fill a fielder in black.
  // Their line is thinner, and it's held at far less: the weighted side still swells it by `weigh`.
  parkFigure: Object.freeze({ widen: 1.3, px: Object.freeze([0.6, 1.8]) }),
  parkPx: 1,                                 // the park's screen-pass lines, px of a 900-wide picture: they lie on top of a man's own line, so they stay thin
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

/** The ink round the park's players (gl/ballpark.js): inkOf's, at HOUSE.parkFigure's width. */
export function parkFigureInkOf(own) {
  if (!comicOn()) return own;
  return { ft: own.ft * HOUSE.parkFigure.widen, px: HOUSE.parkFigure.px, col: HOUSE.ink };
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
 * comic look is on. Thinner than the park's; outlines only, as the park's; and the house ink as it is,
 * since the rink draws straight to the canvas with no grade after it.
 */
export function rinkInkOf(w) {
  if (!comicOn()) return null;
  return { step: Math.max(1, HOUSE.rinkLinePx * w / 900), col: HOUSE.ink };
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
 * How worn each cockpit is drawn in the comic look (V5 of docs/proposals/vehicle-comic.md), by the
 * seat's class. `grime` is hard-edged painted dirt, heavier toward the floor; `chips` are flakes off
 * paint and plastic, each a lighter patch with an ink rim; `hatch` is pen hatching in the darkest
 * band; `grain` is how much of the photographic surface grain is kept (it fights a painted look);
 * `dirt` is what the grime is made of. A 2076 airframe is new: a third of the grime and a quarter of
 * the chips. Faces with no material (lettering, gauge faces, lamps) never take any of it.
 */
export const CABIN_WEAR = Object.freeze({
  // A gold-and-chrome duck that somebody details every week.
  drake: { grime: 0.05, chips: 0, hatch: 0.35, grain: 0.15, dirt: [0.36, 0.30, 0.22] },
  // A fabric-and-tube Cub: dust from grass strips, paint worn off the stick and the sill.
  grasshopper: { grime: 0.45, chips: 0.55, hatch: 0.7, grain: 0.4, dirt: [0.52, 0.42, 0.28] },
  // A crop sprayer: chemical crust in yellow-green, everything scuffed.
  locust: { grime: 0.75, chips: 0.7, hatch: 0.8, grain: 0.35, dirt: [0.48, 0.50, 0.26] },
  // A flying-school 172: clean, a little tired.
  ultralight: { grime: 0.25, chips: 0.25, hatch: 0.55, grain: 0.4, dirt: [0.40, 0.36, 0.32] },
  // A bush freighter: oil and boot dirt on the floor, scuffed consoles.
  prop: { grime: 0.6, chips: 0.5, hatch: 0.7, grain: 0.35, dirt: [0.26, 0.22, 0.17] },
  // A heavy lifter's flight deck: grey industrial grime, worn paint on everything touched.
  heavy: { grime: 0.65, chips: 0.55, hatch: 0.8, grain: 0.3, dirt: [0.24, 0.24, 0.22] },
  // A gun platform: soot and chipped grey enamel.
  gunship: { grime: 0.6, chips: 0.75, hatch: 0.9, grain: 0.3, dirt: [0.16, 0.15, 0.14] },
  // An old dive bomber: oily brown grime and paint flaking to the metal.
  divebomber: { grime: 0.7, chips: 0.85, hatch: 0.9, grain: 0.3, dirt: [0.30, 0.22, 0.13] },
  // A helicopter cockpit: hot, dusty, chipped by boots and kit.
  heli: { grime: 0.55, chips: 0.6, hatch: 0.8, grain: 0.3, dirt: [0.40, 0.34, 0.25] },
  // The wreck you bought: rust-brown crust everywhere.
  wreck: { grime: 0.95, chips: 0.95, hatch: 0.9, grain: 0.3, dirt: [0.36, 0.20, 0.10] },
  // A truck cab: road dirt on the floor, wear on the wheel and the shifter.
  truck: { grime: 0.55, chips: 0.45, hatch: 0.7, grain: 0.35, dirt: [0.30, 0.26, 0.20] },
  // A boat: dried salt, pale, not dark.
  hydro: { grime: 0.5, chips: 0.4, hatch: 0.6, grain: 0.4, dirt: [0.86, 0.85, 0.80] },
  skiff: { grime: 0.6, chips: 0.5, hatch: 0.6, grain: 0.4, dirt: [0.86, 0.85, 0.80] },
  any: { grime: 0.45, chips: 0.45, hatch: 0.7, grain: 0.35, dirt: [0.32, 0.28, 0.22] },
});
const NEW_AIRFRAME = { grime: 0.33, chips: 0.25 };

/**
 * A cockpit's comic look for the class `cls` and its `variant`: null with the comic look off.
 * `wear` is [grime, chips, hatch, grain], `dirt` the grime's colour, `shade` the painted shadow.
 */
export function cabinComicOf(cls, variant) {
  if (!comicOn()) return null;
  const base = String(cls || '').replace(/_2076$/, '');
  const W = CABIN_WEAR[base] || CABIN_WEAR.any;
  const neu = variant === '2076' || /_2076$/.test(String(cls || ''));
  const g = neu ? NEW_AIRFRAME.grime : 1, c = neu ? NEW_AIRFRAME.chips : 1;
  return { wear: [W.grime * g, W.chips * c, W.hatch, W.grain], dirt: W.dirt, shade: HOUSE.shade, ink: HOUSE.ink };
}

/**
 * The cockpit's edge lines (V5) for a target `w` device pixels wide: thinner than the outside's,
 * because the dash is close and busy. Null with the comic look off.
 */
export function cabinInkOf(w) {
  if (!comicOn()) return null;
  const k = w / 900;
  const px = Math.max(1, HOUSE.cityPx * 0.48 * k);
  return { sil: px, detail: px, weigh: 1, col: HOUSE.ink };
}

/**
 * The own ship's edge lines (gl/vehicle-ink.js, V2) for a target `w` device pixels wide: null unless
 * the comic look is on. The outline at the city's width, the creases and part lines at half, never
 * under a pixel, and the figures' weight on the side away from the sun.
 */
export function vehicleInkOf(w) {
  if (!comicOn()) return null;
  const k = w / 900;
  return { sil: Math.max(1, HOUSE.vehiclePx * k), detail: Math.max(1, HOUSE.vehiclePx * 0.5 * k), weigh: HOUSE.weigh, col: HOUSE.ink };
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
