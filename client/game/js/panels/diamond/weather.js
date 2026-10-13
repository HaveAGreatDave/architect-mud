// DEADBALL · THE PARK'S OWN WEATHER. What the weather over the park (a payload's `wx`, read as its
// line airs: the tile's weather word, what's falling and how hard, any city-wide event) does to the
// picture: the haze, the cloud over the stars with the city's glow on it, the field wet under rain,
// the city dimmer through it, what falls and how, and lightning over the skyline in a thunderstorm
// or an ion storm.
//
// Pure: no DOM and no GL. diamond/sky.js folds the look into the park's light, and gl/weather.js
// draws what falls and the bolts, from `boltsBetween`, a function of the world's clock, so every
// TV strikes the same bolt at the same moment.

// By weather word: how much thicker the haze is than on a clear night, how many of the stars show,
// how much brighter the city's glow on the cloud, how bright the city looks through the air, how
// wet the field gets, what falls, and how many bolts a minute.
export const WX = Object.freeze({
  clear: Object.freeze({ haze: 1, stars: 1, glow: 1, city: 1, wet: 0 }),
  cloudy: Object.freeze({ haze: 1.2, stars: 0.35, glow: 1.4, city: 1, wet: 0 }),
  overcast: Object.freeze({ haze: 1.4, stars: 0, glow: 2, city: 0.95, wet: 0 }),
  rain: Object.freeze({ haze: 1.9, stars: 0, glow: 2.2, city: 0.8, wet: 1, fall: 'rain' }),
  sleet: Object.freeze({ haze: 2, stars: 0, glow: 2, city: 0.8, wet: 0.8, fall: 'sleet' }),
  thunderstorm: Object.freeze({ haze: 2.2, stars: 0, glow: 2.4, city: 0.75, wet: 1, fall: 'rain', bolts: 6 }),
  storm: Object.freeze({ haze: 2.4, stars: 0, glow: 2.4, city: 0.7, wet: 1, fall: 'rain', bolts: 3 }),
  snow: Object.freeze({ haze: 1.8, stars: 0, glow: 2.2, city: 0.85, wet: 0.25, fall: 'snow' }),
  blizzard: Object.freeze({ haze: 3.5, stars: 0, glow: 2.6, city: 0.6, wet: 0.25, fall: 'snow' }),
  fog: Object.freeze({ haze: 12, stars: 0, glow: 1.8, city: 0.65, wet: 0.3 }),
  haze: Object.freeze({ haze: 2.6, stars: 0.3, glow: 1.3, city: 0.85, wet: 0 }),
  ash: Object.freeze({ haze: 3, stars: 0, glow: 1.2, city: 0.7, wet: 0, fall: 'ash' }),
});
// What falls: how fast (ft/s), a streak's length (ft, 0 for a flake), a drop's width or a flake's
// size (ft), how many at the heaviest, how far it sways (ft), its colour in the towers' light
// (linear), and whether it adds light (rain catching the floods) or covers what's behind (flakes).
export const FALLS = Object.freeze({
  rain: Object.freeze({ speed: 26, len: 1.6, size: 0.02, n: 2600, sway: 0, col: Object.freeze([0.05, 0.055, 0.062]), add: true }),
  sleet: Object.freeze({ speed: 15, len: 0.6, size: 0.04, n: 2400, sway: 0.2, col: Object.freeze([0.07, 0.074, 0.08]), add: true }),
  snow: Object.freeze({ speed: 3.2, len: 0, size: 0.09, n: 2800, sway: 1.2, col: Object.freeze([0.85, 0.88, 0.92]), add: false }),
  ash: Object.freeze({ speed: 2.2, len: 0, size: 0.08, n: 2400, sway: 0.8, col: Object.freeze([0.34, 0.32, 0.29]), add: false }),
});
// Lightning: how far out the bolts strike (ft, from home plate), how long one lasts (s), its
// colour as it burns (linear, many times white so it blooms), and the ion storm's own: more of
// them, and violet.
export const BOLT = Object.freeze({
  near: 1400, far: 4200, life: 0.6,
  col: Object.freeze([6, 6.3, 7.2]), ion: Object.freeze({ n: 14, col: Object.freeze([4.4, 3.2, 8]) }),
});
// Acid rain is rain with a sick green in it.
const ACID = Object.freeze([0.04, 0.066, 0.03]);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
// mixed again, so two windows whose keys differ only in their last digit don't strike alike
const avalanche = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
const unit = (s) => avalanche(hashStr(s)) / 4294967296;

// What `wx` does to the picture. Returns { word, haze, stars, glow, city, wet, fall (null, or
// FALLS's with `kind` and `rate`, 0 to 1), bolts ({ n a minute, col } or null) }. No weather is
// a clear night.
export function weatherOf(wx) {
  const word = WX[wx?.word] ? wx.word : 'clear', w = WX[word];
  const rate = clamp(Number.isFinite(wx?.rate) ? wx.rate : 0.5, 0, 1);
  const acid = wx?.event === 'acid_rain' || wx?.precip === 'acid';
  const fall = w.fall ? { kind: w.fall, ...FALLS[w.fall], rate: Math.max(0.3, rate), ...(acid && w.fall === 'rain' ? { col: ACID } : {}) } : null;
  const ion = wx?.event === 'ion_storm';
  const bolts = ion ? { n: BOLT.ion.n, col: BOLT.ion.col } : w.bolts ? { n: w.bolts, col: BOLT.col } : null;
  return { word, haze: w.haze, stars: w.stars, glow: w.glow, city: w.city, wet: w.fall ? w.wet * (0.5 + 0.5 * rate) : w.wet, fall, bolts };
}

// The bolts that strike from t0 to t1 on the world's clock (seconds), for weather `we`
// (weatherOf's): each window of 60 / n seconds has one, at a moment, a bearing round the park
// (degrees, 0 out to centre field) and a distance hashed from the window, so it's the same on
// every TV and in a replay of the same moment. Returns [{ t, seed, bearing, dist }].
export function boltsBetween(we, t0, t1) {
  const out = [];
  if (!we?.bolts || !(t1 >= t0)) return out;
  const w = 60 / we.bolts.n;
  for (let k = Math.floor(t0 / w) - 1; k * w <= t1; k++) {
    const t = (k + 0.15 + 0.7 * unit(`bolt|t|${k}`)) * w;
    if (t < t0 - BOLT.life || t > t1) continue;
    out.push({ t, seed: avalanche(hashStr(`bolt|${k}`)), bearing: (unit(`bolt|b|${k}`) * 2 - 1) * 70, dist: BOLT.near + (BOLT.far - BOLT.near) * unit(`bolt|d|${k}`) });
  }
  return out;
}
