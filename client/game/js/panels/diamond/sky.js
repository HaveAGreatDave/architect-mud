// DEADBALL · THE SKY ON COLDWATER'S CLOCK. The park's light at the minute a payload went on air (its
// `clock`), from Coldwater's sky by the hour (client/shared/sky-keys.js, the keyframes GLASS's
// windshield blends): the sky's zenith and horizon, the light the sky gives from above and the
// ground gives back, the haze's colour, the stars, the city's glow and its lit windows, and after
// sunset the last of the day low in the west; and the weather over the park (diamond/weather.js):
// thicker haze, cloud over the stars with the city's glow on its underside, the city dimmer through
// the air, the field wet. Deadball airs from 18:00, so a game starts as the sun goes down, plays
// through the blue hour and is in full night by the third inning or so.
//
// At full night on a clear night the look is the park as it was tuned for night (`NIGHT`), exactly. Before that
// each colour is the night's with the sky's own light over full night's added, in the sky's own
// hue and in linear light, brought to the park's exposure by how bright the night's colour is
// against the night sky's; the horizon toward the sun is the sky's horizon and the one away from it
// nearer its zenith, and the haze is the cooler of the two.
//
// Pure: no DOM and no GL. gl/ballpark.js draws it (setHour).

import { skyAt, sunAt } from '../../../../shared/sky-keys.js';
import { mapAxes } from '../../../../shared/city-set.js';
import { weatherOf } from './weather.js';

// The night the park was tuned at: the sky's colours, its ambient from above (`up`) and below
// (`dn`), the city's glow low in the sky, how hard the towers burn, and the air: a haze that thins
// over 160 ft of height, and how much of the towers' light it scatters. Then the city: its windows
// and the park's arcade, the lamps' pools, the Curtain (well down from the flight sim's strength,
// so the field stays the brightest thing in the picture), the park's sign.
export const NIGHT = Object.freeze({
  up: [0.006, 0.008, 0.016], dn: [0.024, 0.032, 0.017], zen: [0.0018, 0.0024, 0.0065], hor: [0.005, 0.006, 0.009],
  glow: [0.010, 0.008, 0.006], towers: 3.6,
  fog: [0.004, 0.0045, 0.0055], fogDens: 0.00022, fogH: 160, shaft: 1.0, shaftReach: 260,
  cityLit: 1.5, pool: 0.032, curtain: 0.32, sign: 9,
});
// The dusk: how much brighter than the night's the park's light may get (a cap on its luminance, so
// the sunset doesn't wash the field out under the towers); how far the horizon away from the sun is
// toward the zenith; how strongly a venue's own city glow (`city.glow`, an sRGB colour) shows at
// full night; when the city's windows, its lamps and its buildings' own lights (signs, beacons,
// searchlights) come on and the stars come out (the sky's `night`, 0 by day to 1).
export const DUSK = Object.freeze({ cap: 60, away: 0.6, glow: 0.015, windows: [0.35, 0.95], lamps: [0.3, 0.7], lights: [0.15, 0.6], stars: [0.6, 0.95], moon: [0.3, 0.7] });

const lin1 = (c) => { const x = Math.max(0, c) / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const lin = (c) => c.map(lin1);
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const AT_NIGHT = skyAt(0);
// The night's value with the sky's light over full night's (`c` against `n`, linear) added at the
// park's exposure (the night value's luminance against the night sky's), no brighter than the cap.
function lift(night, c, n) {
  const k = lum(night) / lum(n), d = c.map((v, i) => Math.max(0, v - n[i]) * k), room = (DUSK.cap - 1) * lum(night), f = lum(d) > room ? room / lum(d) : 1;
  return night.map((v, i) => v + d[i] * f);
}

// The low sun before it sets: up over the horizon on a curve that sets it at 18:30, as the sky's
// keyframes have it (sky-keys.js sunAt's own sine is down by 18:00), warmer and weaker the lower it
// is, gone through cloud. `strength` is its light at full, in the park's linear units (the towers
// are NIGHT.towers); `fade` the degrees over which it comes up off the horizon.
export const SUN = Object.freeze({ strength: 5, fade: 2.5, low: [1, 0.42, 0.16], high: [1, 0.84, 0.64] });
export function sunLight(hour, ground, cloud = 0) {
  if (!Number.isFinite(hour) || !ground) return null;
  const h = ((hour % 24) + 24) % 24, el = 62 * Math.sin(Math.PI * (h - 6.5) / 12);
  if (!(el > 0) || h < 6.5 || h > 18.5) return null;
  const k = smooth(0, SUN.fade, el) * (1 - Math.min(1, Math.max(0, cloud))) * SUN.strength, e = (el * Math.PI) / 180;
  if (!(k > 0)) return null;
  const col = mix(SUN.low, SUN.high, smooth(2, 20, el)).map((v) => v * k);
  return { dir: [ground[0] * Math.cos(e), Math.sin(e), ground[2] * Math.cos(e)], col, el };
}

// The park's light at `hour` (in-game, 0 to 24). `o.bearing` is the venue's (the compass bearing
// centre field lies on, cast in the city set's way: city-set.js mapAxes); `o.glow` the venue's city
// glow; `o.wx` the payload's weather. Returns NIGHT's keys, each for the hour and the weather, and
// `horAway` (the horizon away from the sun), `sun` (the way to where the sun went down, in the
// park's frame, a unit vector on the ground), `stars`, `night`, `wet` (0 dry to 1 soaked) and
// `lights` (how lit the buildings' own lights are, 0 to 1, gl/citylights.js); `o.moon` tonight's
// phase, and `moon` where it is (moonAt).
export function skyLook(hour, o = {}) {
  const s = skyAt(Number.isFinite(hour) ? hour : 0), sun = sunAt(Number.isFinite(hour) ? hour : 0), n = AT_NIGHT;
  // away from the sun the horizon is nearer the zenith's colour
  const away = lin(mix(s.hor, s.top, DUSK.away)), nAway = lin(mix(n.hor, n.top, DUSK.away));
  const { EX, EN } = mapAxes(o.bearing), a = (sun.az * Math.PI) / 180;
  const dir = [EN[0] * Math.cos(a) + EX[0] * Math.sin(a), 0, EN[2] * Math.cos(a) + EX[2] * Math.sin(a)];
  const l = Math.hypot(dir[0], dir[2]) || 1;
  const glow = (Array.isArray(o.glow) && o.glow.length === 3 ? o.glow.map((v) => lin1(v) * DUSK.glow) : NIGHT.glow).map((v) => v * s.night * s.night);
  // the weather: under cloud the stars go, the warm horizon greys and the city's glow lights the
  // cloud's underside and the haze; through the air the city's dimmer
  const we = weatherOf(o.wx), cover = 1 - we.stars;
  const hor = lift(NIGHT.hor, lin(s.hor), lin(n.hor)), horAway = lift(NIGHT.hor, away, nAway);
  const fog = lift(NIGHT.fog, away, nAway).map((v, i) => v + glow[i] * (we.glow - 1) * 0.5);
  // and a clouded sky is grey: the blue goes out of it, and a little of its light, by how covered it is
  const grey = (c) => (cover ? mix(c, c.map(() => lum(c) * 0.8), cover * 0.85) : c);
  return {
    ...NIGHT,
    zen: grey(lift(NIGHT.zen, lin(s.top), lin(n.top))), hor: grey(cover ? mix(hor, horAway, cover * 0.75) : hor), horAway: grey(horAway),
    up: grey(lift(NIGHT.up, lin(s.top), lin(n.top))), dn: lift(NIGHT.dn, lin(s.g1), lin(n.g1)), fog,
    glow: glow.map((v) => v * we.glow), fogDens: NIGHT.fogDens * we.haze,
    cityLit: NIGHT.cityLit * smooth(DUSK.windows[0], DUSK.windows[1], s.night) * we.city,
    pool: NIGHT.pool * smooth(DUSK.lamps[0], DUSK.lamps[1], s.night) * we.city,
    stars: smooth(DUSK.stars[0], DUSK.stars[1], s.night) * we.stars, night: s.night, wet: we.wet,
    lights: smooth(DUSK.lights[0], DUSK.lights[1], s.night) * we.city,
    sun: [dir[0] / l, 0, dir[2] / l],
    // the low sun's own light, or null once it's down (sunLight)
    sunLight: sunLight(hour, [dir[0] / l, 0, dir[2] / l], cover),
    // the sun's disc while it's up: [x, y, z] toward it in the park's frame, and how much shows
    sunDisc: sun.up ? { dir: [Math.cos((sun.el * Math.PI) / 180) * dir[0] / l, Math.sin((sun.el * Math.PI) / 180), Math.cos((sun.el * Math.PI) / 180) * dir[2] / l], a: we.stars } : null,
    // the moon (moonAt), out once the stars are and gone behind cloud as they are
    moon: moonAt(hour, o.moon, EX, EN, smooth(DUSK.moon[0], DUSK.moon[1], s.night) * we.stars),
  };
}

// The moon at `hour` for a `phase` (0 new, 0.5 full; shared/moon.js), on the arc windshield.js
// moonArc gives it: it lags the sun by `phase` of a day, rises in the east and sets in the west 12
// hours later, MOON_PEAK degrees up at transit. Returns { dir (unit, toward it, in the park's frame),
// sun (toward the sun, for which side is lit), cosPh (cos of the phase angle), a (how much of it shows,
// 0 to 1) }, or null while it's down or there's nothing to see.
const MOON_PEAK = 55;
function moonAt(hour, phase, EX, EN, show) {
  if (!Number.isFinite(phase)) phase = 0.5;
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 0;
  const t = ((((h - 6 - (((phase % 1) + 1) % 1) * 24) % 24) + 24) % 24) / 12;
  const lit = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  if (t > 1 || !(show * lit > 0.01)) return null;
  const at = (azDeg, elDeg) => {
    const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180, c = Math.cos(el);
    return [(EN[0] * Math.cos(az) + EX[0] * Math.sin(az)) * c, Math.sin(el), (EN[2] * Math.cos(az) + EX[2] * Math.sin(az)) * c];
  };
  const st = (h - 6) / 12;
  return {
    dir: at(90 + t * 180, Math.sin(t * Math.PI) * MOON_PEAK), sun: at(90 + st * 180, Math.sin(st * Math.PI) * 62),
    cosPh: Math.cos(2 * Math.PI * phase), a: show * Math.min(1, Math.sin(t * Math.PI) * 6),
  };
}
