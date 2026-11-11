// THE OUTSIDE, LAYERED. The weather beds and the city bed the audio plugin sends to a player standing
// outdoors (or hearing outdoors through a door). Each is a field recording (client/shared/
// field-recordings.js) with SIREN layers on top that are always on, not stand-ins: patter and run-off
// over the rain, gusts and a whistle in the wind, and one-shots (`sparkle`) for the drips, the clanks
// and the trains. The old filtered-noise bed is kept as each recording's `alt` stand-in, which plays
// until the recording has decoded.
//
// ⚠ EVERY BED HERE IS `whole`. Its level is the server's audio_loop_gain on one gain node, and its
// sparkles go through that node too, so a bed heard through a wall drips through the wall as well. A
// whole bed starts silent: always send the loop gain after the ambience.
// ⚠ NO HORNS. The city bed is traffic as a wash, the mains, the plant on the roofs, a train a long way
// off, the odd clank and a pigeon. Sirens and car horns stay out (David, 2026-11-10).

import { fieldBed, fieldCall } from '../../client/shared/field-recordings.js';

const noise = (seed, colour, filter, gain, mods, adsr = { a: 2, d: 0, s: 1, r: 2 }) =>
  ({ waveform: 'noise', noise: colour, noiseMix: 1, noiseSeed: seed, filter, adsr, gain, ...(mods ? { mods } : {}) });
// a slow smooth wander on the cutoff (cents) and the level
const sway = (seed, rate, cents, amp) => [{ id: 'mv', type: 'rand', rate, smooth: true, seed, to: [{ param: 'filter.cutoff', amount: cents }, { param: 'amp', amount: amp }] }];
// sparse bursts: `density` of `rate` steps a second sound, each at its own pitch
const bursts = (seed, rate, density, cents) => [{ id: 'gt', type: 'rand', rate, density, seed, to: [{ param: 'amp', amount: 1 }] }, { id: 'pr', type: 'rand', rate, seed: seed + 1, to: [{ param: 'filter.cutoff', amount: cents }] }];
const tone = (waveform, freq, gain, filter, adsr = { a: 2, d: 0, s: 1, r: 2 }, extra = {}) => ({ waveform, freq, gain, adsr, ...(filter ? { filter } : {}), ...extra });
const hit = (a, d, r = d) => ({ a, d, s: 0, r });

// `trim` levels the whole bed, one-shots included: measured at the master in the game's own mix, the
// weather sits about -34 to -28 dBFS (rain to storm) and the city under it near -36.
const trimL = (layers, t) => layers.map((l) => ({ ...l, gain: (l.gain ?? 1) * t }));
const bed = (id, layers, sparkle, trim = 1) => ({ id, name: id, category: 'ambient', priority: 2, config: { gain: 1, whole: true, layers: trimL(layers, trim), ...(sparkle ? { sparkle: sparkle.map((sp) => ({ ...sp, gain: (sp.gain ?? 1) * trim })) } : {}) } });
const stand = (layers) => layers.map((l) => ({ ...l, alt: true }));
const rec = (key, lufs, extra) => fieldBed(key, lufs, extra);
const all = (...xs) => xs.flat().filter(Boolean);

// ── the one-shots ────────────────────────────────────────────────────────────────────────────────
// A drop off a gutter onto something hollow: a sine plink that falls, and its tick.
const DRIP = { everyMin: 0.7, everyMax: 2.6, prob: 0.85, gain: 0.5, duration: 0.25, jitter: 0.3, layers: [
  tone('sine', 1500, 0.16, null, hit(0.002, 0.09, 0.12), { pitchBend: { to: 900, time: 0.08 } }),
  noise(7101, 'white', { type: 'bandpass', freq: 4200, q: 3 }, 0.25, null, hit(0.001, 0.03, 0.05)),
] };
// A downspout coughing: a short gurgle low in the run-off.
const GURGLE = { everyMin: 3, everyMax: 9, prob: 0.7, gain: 0.55, duration: 0.9, jitter: 0.2, layers: [
  noise(7111, 'pink', { type: 'bandpass', freq: 520, q: 4 }, 0.6, bursts(7112, 14, 0.5, 600), hit(0.05, 0.5, 0.4)),
] };
// A gust coming through: a swell of air that peaks and goes.
const GUST = { everyMin: 4, everyMax: 12, prob: 0.8, gain: 0.7, duration: 2.6, jitter: 0.25, layers: [
  noise(7121, 'pink', { type: 'bandpass', freq: 650, q: 1.4 }, 0.6, sway(7122, 0.9, 900, 0.4), { a: 1.1, d: 0.6, s: 0.5, r: 1.4 }),
  noise(7123, 'white', { type: 'highpass', freq: 3000, q: 0.5 }, 0.08, null, { a: 1, d: 0.5, s: 0.4, r: 1.2 }),
] };
// Something loose in the wind: a sign or a shutter knocking twice.
const RATTLE = { everyMin: 7, everyMax: 22, prob: 0.6, gain: 0.45, duration: 0.5, jitter: 0.2, layers: [
  noise(7131, 'brown', { type: 'bandpass', freq: 380, q: 2 }, 0.9, null, hit(0.002, 0.09, 0.1)),
  { ...noise(7133, 'brown', { type: 'bandpass', freq: 400, q: 2 }, 0.5, null, hit(0.002, 0.08, 0.1)), delay: 0.17 },
  tone('triangle', 240, 0.12, null, hit(0.002, 0.12, 0.1)),
] };
// Hail and sleet finding metal.
const TICK = { everyMin: 0.25, everyMax: 1, prob: 0.9, gain: 0.35, duration: 0.12, jitter: 0.4, layers: [
  noise(7141, 'white', { type: 'bandpass', freq: 5200, q: 6 }, 0.6, null, hit(0.001, 0.025, 0.04)),
  tone('square', 2400, 0.04, { type: 'bandpass', freq: 2400, q: 8 }, hit(0.001, 0.02, 0.03)),
] };

// ── the weather beds ─────────────────────────────────────────────────────────────────────────────
const RAIN_STAND = [
  noise(7001, 'white', { type: 'lowpass', freq: 4200, q: 0.6 }, 0.55),
  noise(7002, 'white', { type: 'highpass', freq: 600, q: 0.5 }, 0.18),
];
// the patter: sparse bright bursts, close drops on the pavement
const PATTER = (seed, gain) => noise(seed, 'white', { type: 'bandpass', freq: 3400, q: 0.9 }, gain, bursts(seed + 1, 90, 0.28, 900), { a: 1, d: 0, s: 1, r: 1 });
// the run-off: water moving in the gutters, low and wandering
const RUNOFF = (seed, gain) => noise(seed, 'pink', { type: 'bandpass', freq: 700, q: 1.2 }, gain, sway(seed + 1, 0.18, 500, 0.4));
const ROAR = (seed, gain) => noise(seed, 'brown', { type: 'lowpass', freq: 260, q: 0.7 }, gain, sway(seed + 1, 0.1, 300, 0.3));
const WIND_STAND = [
  noise(7051, 'pink', { type: 'bandpass', freq: 500, q: 1.2 }, 0.5, null, { a: 2.5, d: 0, s: 1, r: 2.5 }),
  noise(7052, 'white', { type: 'lowpass', freq: 1500, q: 0.4 }, 0.2, null, { a: 2.5, d: 0, s: 0.5, r: 2.5 }),
];
// the howl round corners: a narrow band that wanders in pitch and level
const WHISTLE = (seed, gain, freq = 1400) => noise(seed, 'white', { type: 'bandpass', freq, q: 9 }, gain, sway(seed + 1, 0.2, 900, 0.85));
const BODY = (seed, gain) => noise(seed, 'pink', { type: 'bandpass', freq: 420, q: 1.1 }, gain, sway(seed + 1, 0.15, 1100, 0.7));

export const WEATHER_BEDS = {
  rain: bed('wx_amb_rain', all(stand(RAIN_STAND), rec('rain_light', -18), PATTER(7011, 0.05), RUNOFF(7013, 0.06)), [DRIP], 2.4),
  rain_heavy: bed('wx_amb_rain_heavy', all(stand(RAIN_STAND), rec('rain_heavy', -16), PATTER(7021, 0.07), RUNOFF(7023, 0.1), ROAR(7025, 0.12)), [DRIP, GURGLE], 2.2),
  // a storm is the downpour with the wind in it
  storm: bed('wx_amb_storm', all(stand(RAIN_STAND), rec('rain_thunder', -17), rec('wind', -24), ROAR(7031, 0.16), BODY(7033, 0.1), WHISTLE(7035, 0.03)), [GURGLE, GUST], 3.6),
  sleet: bed('wx_amb_sleet', all(stand([
    noise(7041, 'white', { type: 'bandpass', freq: 5200, q: 0.8 }, 0.5, null, { a: 1, d: 0, s: 1, r: 1 }),
    noise(7042, 'white', { type: 'highpass', freq: 3000, q: 0.6 }, 0.22, null, { a: 1, d: 0, s: 0.6, r: 1 }),
  ]), rec('hail', -18), RUNOFF(7043, 0.04)), [TICK], 2.4),
  // Snow has no recording of its own: falling snow is near silent. A hush and a little wind.
  snow: bed('wx_amb_snow', all(noise(7061, 'pink', { type: 'lowpass', freq: 1100, q: 0.5 }, 0.12, sway(7062, 0.07, 300, 0.3)), rec('wind', -30)), undefined, 1.8),
  blizzard: bed('wx_amb_blizzard', all(stand([
    noise(7071, 'brown', { type: 'lowpass', freq: 1800, q: 0.8 }, 0.6),
    noise(7072, 'pink', { type: 'bandpass', freq: 750, q: 1.5 }, 0.3),
  ]), rec('blizzard', -17), WHISTLE(7073, 0.04, 1800), BODY(7075, 0.12)), [GUST], 1.75),
  wind: bed('wx_amb_wind', all(stand(WIND_STAND), rec('wind', -20), BODY(7081, 0.1), WHISTLE(7083, 0.025)), [GUST, RATTLE], 2.2),
};

// ── the city ─────────────────────────────────────────────────────────────────────────────────────
// A train on the elevated line, a long way off: a rumble that comes up and goes.
const TRAIN = { everyMin: 45, everyMax: 110, prob: 0.8, gain: 0.8, duration: 9, jitter: 0.1, layers: [
  noise(7201, 'brown', { type: 'lowpass', freq: 240, q: 0.8 }, 0.9, sway(7202, 3, 250, 0.35), { a: 3.5, d: 1.5, s: 0.6, r: 3.5 }),
  noise(7203, 'pink', { type: 'bandpass', freq: 1300, q: 3 }, 0.08, bursts(7204, 6, 0.6, 300), { a: 3.5, d: 1.5, s: 0.5, r: 3.5 }),
  tone('sawtooth', 43, 0.05, { type: 'lowpass', freq: 140, q: 0.7 }, { a: 3.5, d: 1.5, s: 0.6, r: 3.5 }),
] };
// Metal on metal somewhere down the street: a dropped bar, a gate, a skip lid.
const CLANK = { everyMin: 9, everyMax: 26, prob: 0.6, gain: 0.35, duration: 0.7, jitter: 0.25, layers: [
  noise(7211, 'white', { type: 'bandpass', freq: 1900, q: 7 }, 0.5, null, hit(0.002, 0.3, 0.35)),
  tone('triangle', 640, 0.07, null, hit(0.002, 0.35, 0.4), { pitchBend: { to: 610, time: 0.3 } }),
  tone('sine', 1717, 0.03, null, hit(0.002, 0.25, 0.3)),
] };
// A door or a shutter going down: a dull low thump.
const THUMP = { everyMin: 14, everyMax: 40, prob: 0.6, gain: 0.45, duration: 0.4, jitter: 0.2, layers: [
  noise(7221, 'brown', { type: 'lowpass', freq: 320, q: 1 }, 1, null, hit(0.003, 0.14, 0.18)),
  tone('sine', 85, 0.18, null, hit(0.003, 0.12, 0.16), { pitchBend: { to: 55, time: 0.12 } }),
] };
// A pigeon on a ledge. The call is a recording; its stand-in is a soft coo.
const PIGEON = (seed) => ({ everyMin: 18, everyMax: 50, prob: 0.5, gain: 0.5, duration: 1.6, jitter: 0, layers: all(
  tone('sine', 420, 0.05, null, { a: 0.08, d: 0.3, s: 0.2, r: 0.3 }, { alt: true, pitchBend: { to: 360, time: 0.4 } }),
  fieldCall('pigeon', seed, -22),
) });

const CITY_LAYERS = [
  // the traffic, as a wash: tyres and engines blurred together a few streets away
  noise(7301, 'brown', { type: 'lowpass', freq: 340, q: 0.7 }, 0.5, sway(7302, 0.06, 500, 0.45)),
  noise(7303, 'pink', { type: 'bandpass', freq: 950, q: 0.7 }, 0.05, sway(7304, 0.11, 600, 0.6)),
  // the plant on the roofs: fans and compressors, and the mains under it
  noise(7305, 'pink', { type: 'bandpass', freq: 165, q: 3 }, 0.12, sway(7306, 0.04, 120, 0.2)),
  tone('sawtooth', 50, 0.012, { type: 'lowpass', freq: 200, q: 0.7 }),
  tone('sine', 238, 0.004),
];
export const CITY_BEDS = {
  city: bed('amb_city', CITY_LAYERS, [TRAIN, CLANK, THUMP, PIGEON(3)], 0.6),
  // the same streets in the wet: tyres hiss on the road
  city_wet: bed('amb_city_wet', all(CITY_LAYERS, noise(7311, 'white', { type: 'highpass', freq: 2600, q: 0.5 }, 0.035, sway(7312, 0.09, 700, 0.75))), [TRAIN, CLANK, THUMP], 0.6),
};

// The ambient themes that are a city's streets (zones.ambient_theme).
export const CITY_THEMES = new Set(['city', 'urban', 'residential', 'waterfront']);
// The city by the hour: quietest at four in the morning, full in the day.
export function cityGainFor(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h < 20) return 1;
  if (h >= 1 && h < 5) return 0.4;
  return 0.65;
}
