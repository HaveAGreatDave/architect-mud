// COLDWATER'S SKY BY THE HOUR: the keyframes GLASS's windshield blends for its sky, its distance fog
// and its lights (client/game/js/panels/windshield.js), and the Grandstand's park blends for its
// own (client/game/js/panels/diamond/sky.js), so a game's dusk on KSAB is the cockpit's. Colours
// are 0 to 255 sRGB: the zenith (`top`), the horizon (`hor`), the ground near and far (`g1`,
// `g2`); `night` is 0 by day and 1 at full night; `sun` is the sun's colour while it's up, null
// once it's down.
//
// Pure: no DOM.

// ── Time-of-day sky keyframes (blended by hour) ───────────────────────────────
export const SKY = Object.freeze([
  // ⚠ THE NIGHT SKY IS EVERY REGION'S NIGHT SKY, AND THAT IS WHY THE CITY'S GLOW IS NOT IN HERE.
  // A violet horizon was tried here first and it is the right LOOK and the wrong PLACE: `hor` feeds
  // the distance fog for the whole world, so Coldwater's light pollution arrived over the
  // Scarletwastes, where there is no city to make it, and over Terminus, which must never read as
  // cyberpunk. The glow belongs to the region that emits it — see `glow` in REGION_GRADE.
  // ⚠ THE SUNSET USED TO LAST UNTIL THE SMALL HOURS, and that is what made the default night sky
  // red. There were two night rows and four warm ones, so every hour between them was a LINEAR
  // BLEND of the two: at 20:00 `night` was already 0.8 — city lights on, stars coming up, a player
  // calling it night — over a horizon still at [84,56,47], and the dawn half was worse, because the
  // 00:00→05:30 leg meant the eastern sky started warming at about 2 a.m. and was frankly orange by
  // three. So the darkest the sky ever got was a single INSTANT at midnight rather than a state, and
  // a sunset colour was the default sky colour for most of the night.
  //
  // The fix is a cold twilight row on each side, half an hour after sunset and half an hour before
  // sunrise. The warmth is then a narrow event at the horizon crossing (which is what a sunset is),
  // the blue hour is its own colour rather than a waypoint on the way to one, and the deep-night row
  // is HELD from 20:00 through to 04:24 instead of being touched once and left.
  //
  // ⚠ THE FIRST AND LAST ROWS MUST STAY IDENTICAL. `skyAt` finds the bracketing pair by scanning
  // forward, and the hours past the last row (here 20:00→24:00) bracket nothing — so it falls back
  // to its initialiser, which is row 0 against row N-1, and extrapolates across the whole table.
  // That is only harmless because both ends are the same colour, which makes the blend degenerate.
  // Change one end and the last four hours of the day become a garbage extrapolation.
  { h: 0,    top: [5, 6, 14],    hor: [14, 16, 30],    g1: [14, 17, 19], g2: [4, 6, 8],   night: 1,    sun: null },
  { h: 4.4,  top: [5, 6, 14],    hor: [14, 16, 30],    g1: [14, 17, 19], g2: [4, 6, 8],   night: 1,    sun: null },
  { h: 5,    top: [16, 19, 46],  hor: [44, 42, 72],    g1: [22, 26, 26], g2: [7, 9, 11],  night: 0.88, sun: null },
  { h: 5.5,  top: [40, 46, 84],  hor: [206, 122, 84],  g1: [42, 46, 36], g2: [15, 17, 13], night: 0.5, sun: [255, 176, 116] },
  { h: 8,    top: [26, 108, 166],hor: [156, 196, 216], g1: [56, 72, 42], g2: [22, 30, 16], night: 0,   sun: [255, 246, 214] },
  { h: 16,   top: [26, 108, 166],hor: [156, 196, 216], g1: [56, 72, 42], g2: [22, 30, 16], night: 0,   sun: [255, 246, 214] },
  { h: 18.5, top: [44, 48, 92],  hor: [228, 118, 56],  g1: [46, 40, 30], g2: [17, 13, 10], night: 0.5, sun: [255, 146, 84] },
  { h: 19.1, top: [16, 19, 46],  hor: [44, 42, 72],    g1: [22, 26, 26], g2: [7, 9, 11],  night: 0.88, sun: null },
  { h: 20,   top: [5, 6, 14],    hor: [14, 16, 30],    g1: [14, 17, 19], g2: [4, 6, 8],   night: 1,    sun: null },
]);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
export function skyAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  let a = SKY[0], b = SKY[SKY.length - 1];
  for (let i = 0; i < SKY.length - 1; i++) { if (h >= SKY[i].h && h <= SKY[i + 1].h) { a = SKY[i]; b = SKY[i + 1]; break; } }
  const t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  return {
    top: mix(a.top, b.top, t), hor: mix(a.hor, b.hor, t),
    g1: mix(a.g1, b.g1, t), g2: mix(a.g2, b.g2, t),
    night: lerp(a.night, b.night, t),
    sun: a.sun && b.sun ? mix(a.sun, b.sun, t) : (t < 0.5 ? a.sun : b.sun),
  };
}

// Where the sun is at an hour, as the windshield puts it: up in the east at 06:00, south at noon,
// down in the west at 18:00 and below the horizon from 18:30 to 05:30. Returns { az (compass
// degrees, 90 east), el (degrees above the horizon), up }.
export function sunAt(hour) {
  const h = ((hour % 24) + 24) % 24, t = Math.min(1, Math.max(0, (h - 6) / 12)), up = h > 5.5 && h < 18.5;
  return { az: 90 + t * 180, el: up ? Math.sin(t * Math.PI) * 62 : 0, up };
}
