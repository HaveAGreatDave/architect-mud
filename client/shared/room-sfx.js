// THE OUTSIDE, HEARD FROM A ROOM. SIREN cues for the Room Stage: rain on the glass, wind on the building and
// thunder (panels/room-sound.js plays them), and the birds and the sea through the window. A bank like deadball-sfx.js, so the dev panel's Audio tab lists
// them and an override in `interface_sfx` wins.
//
// `windowMix` is how loud each should be from where you stand. It's here and not in the player so a gate
// can ask it, in Node, whether the bathroom is quieter than the balcony.
//
// ⚠ THE WEATHER, THE BIRDS AND THE SEA, AND NOTHING ELSE. A city bed, the sea, aircraft, horns and sirens were
// tried and taken out on request: a room is somewhere quiet. The birds and the sea came back on request on
// 2026-11-09 as recordings, from the flocks and the shore actually round the building (room-outdoors.js), so
// a flat with no water in reach hears none. Traffic, aircraft and sirens stay out.
// ⚠ A BED'S LEVEL IS THE ROOM'S, NOT THE CUE'S. Each cue is built at full level and `windowMix` sets the
// fraction, through loopSound's `whole` gain, so setLoopGain moves every layer. It keeps them well under
// what's going on in the room.

import { fieldBed, fieldCall } from './field-recordings.js';

const noise = (seed, colour, filter, gain, mods, adsr = { a: 1.2, d: 0.2, s: 1, r: 1.2 }) => ({ waveform: 'noise', noise: colour, noiseMix: 1, noiseSeed: seed, filter, adsr, gain, mods });
// the bed moving: a slow smooth wander on the cutoff (cents) and the level
const sway = (seed, rate, cents, amp) => [{ id: 'mv', type: 'rand', rate, smooth: true, seed, to: [{ param: 'filter.cutoff', amount: cents }, { param: 'amp', amount: amp }] }];
// sparse bursts: `density` of `rate` steps a second sound, each at its own pitch
const bursts = (seed, rate, density, cents) => [{ id: 'gt', type: 'rand', rate, density, seed, to: [{ param: 'amp', amount: 1 }] }, { id: 'pr', type: 'rand', rate, seed: seed + 1, to: [{ param: 'filter.cutoff', amount: cents }] }];
const engine = (freq, gain, cut, extra = {}) => ({ waveform: 'sawtooth', freq, filter: { type: 'lowpass', freq: cut, q: 0.7 }, adsr: { a: 1.5, d: 0.2, s: 1, r: 1.5 }, gain, ...extra });
// `trim` levels a cue to its target: -20 LUFS for a bed, -16 for a one-shot, under -1 dBFS (scripts/audio/room-sound-smoke.mjs)
const trimmed = (layers, trim) => layers.map((l) => ({ ...l, gain: l.gain * trim }));
const bed = (id, name, trim, layers, priority = 1) => ({ id, name, group: 'room', category: 'ambient', priority, loop: true, config: { gain: 1, layers: trimmed(layers, trim) } });
const shot = (id, name, trim, duration, layers, priority = 3) => ({ id, name, group: 'room', category: 'sfx', priority, config: { duration, layers: trimmed(layers, trim), vary: { cents: 60, gain: 1.5 } } });
// A field recording (field-recordings.js) as the cue's voice, the synth kept as its `alt` stand-in
// until the recording has decoded. The gates hear the stand-in (there's no fetch in Node), so the
// recording is levelled to the same target the stand-in is held to.
const recorded = (def, layer) => (layer ? { ...def, config: { ...def.config, layers: [...def.config.layers.map((l) => ({ ...l, alt: true })), layer], duration: def.loop ? def.config.duration : Math.max(def.config.duration ?? 0, layer.length ?? 0) } } : def);

const SYNTH = [
  bed('room-rain', 'Room: rain on the glass', 0.36, [
    noise(5131, 'white', { type: 'bandpass', freq: 3600, q: 0.8 }, 0.5, bursts(5132, 120, 0.3, 900), { a: 0.6, d: 0.1, s: 1, r: 0.8 }),
    noise(5133, 'pink', { type: 'highpass', freq: 1700, q: 0.5 }, 0.17, sway(5134, 0.22, 500, 0.25)),
    noise(5135, 'pink', { type: 'bandpass', freq: 860, q: 1 }, 0.44, bursts(5136, 34, 0.2, 700), { a: 0.6, d: 0.1, s: 1, r: 0.8 }),
    noise(5137, 'brown', { type: 'lowpass', freq: 280, q: 0.7 }, 0.2, sway(5138, 0.11, 240, 0.2)),
  ]),
  // the open-air rain, for the balcony and an open door: no glass, so the high end and the splash are all there
  bed('room-rain-out', 'Room: rain in the open', 0.34, [
    noise(5151, 'white', { type: 'highpass', freq: 2400, q: 0.5 }, 0.42, sway(5152, 0.3, 400, 0.2)),
    noise(5153, 'white', { type: 'bandpass', freq: 5200, q: 0.7 }, 0.36, bursts(5154, 160, 0.4, 1100), { a: 0.5, d: 0.1, s: 1, r: 0.8 }),
    noise(5155, 'pink', { type: 'bandpass', freq: 1200, q: 0.8 }, 0.3, sway(5156, 0.17, 500, 0.3)),
  ]),
  bed('room-rain-heavy', 'Room: a downpour in the open', 0.3, [
    noise(5161, 'white', { type: 'highpass', freq: 1500, q: 0.5 }, 0.5, sway(5162, 0.25, 600, 0.3)),
    noise(5163, 'pink', { type: 'bandpass', freq: 700, q: 0.7 }, 0.5, sway(5164, 0.19, 500, 0.35)),
    noise(5165, 'brown', { type: 'lowpass', freq: 320, q: 0.7 }, 0.35, sway(5166, 0.12, 300, 0.3)),
  ]),
  bed('room-wind', 'Room: wind on the building', 0.56, [
    noise(5141, 'pink', { type: 'bandpass', freq: 430, q: 1.1 }, 0.62, sway(5142, 0.16, 1200, 0.7)),
    noise(5143, 'brown', { type: 'lowpass', freq: 210, q: 0.7 }, 0.34, sway(5144, 0.11, 300, 0.45)),
    noise(5145, 'white', { type: 'bandpass', freq: 1500, q: 9 }, 0.2, sway(5146, 0.2, 800, 0.85)),
  ]),
  shot('room-thunder', 'Room: thunder, close', 0.3, 6, [
    noise(5201, 'white', { type: 'bandpass', freq: 1500, q: 0.6 }, 0.7, undefined, { a: 0.002, d: 0.14, s: 0, r: 0.25 }),
    noise(5202, 'brown', { type: 'lowpass', freq: 170, q: 0.7 }, 1, sway(5203, 2.4, 300, 0.7), { a: 0.03, d: 2.4, s: 0.2, r: 2.6 }),
    noise(5204, 'pink', { type: 'bandpass', freq: 520, q: 0.5 }, 1.1, sway(5205, 3.1, 400, 0.8), { a: 0.05, d: 1.6, s: 0.1, r: 2 }),
  ], 4),
  shot('room-thunder-far', 'Room: thunder, a long way off', 0.26, 6.5, [
    noise(5211, 'brown', { type: 'lowpass', freq: 130, q: 0.7 }, 1, sway(5212, 1.7, 260, 0.75), { a: 0.5, d: 2.4, s: 0.25, r: 3 }),
    noise(5213, 'pink', { type: 'bandpass', freq: 340, q: 0.5 }, 1.4, sway(5214, 2.1, 300, 0.8), { a: 0.6, d: 1.8, s: 0.15, r: 2.6 }),
  ], 4),
];

// Rain recorded from indoors, wind, and two claps; the far one through a lowpass, as the synth's is.
const FIELD_OF = {
  'room-rain': () => fieldBed('rain_indoor', -20),
  'room-rain-out': () => fieldBed('rain_light', -20),
  'room-rain-heavy': () => fieldBed('rain_heavy', -20),
  'room-wind': () => fieldBed('wind', -20),
  'room-thunder': () => fieldCall('thunder_a', 0, -16),
  'room-thunder-far': () => fieldCall('thunder_b', 0, -18, { filter: { type: 'lowpass', freq: 700, q: 0.6 }, rate: 0.9 }),
};
export const BUILTINS = SYNTH.map((d) => recorded(d, FIELD_OF[d.id]?.()));

globalThis.SFXCatalog?.addBank?.(BUILTINS, 'room', 'Room Stage (through the window)');

// The beds.
// `room-rain` is the rain through glass; `room-rain-out` and `room-rain-heavy` are the same rain with nothing
// in between, faded in as you open the door and step out.
export const ROOM_BEDS = Object.freeze(['room-rain', 'room-rain-out', 'room-rain-heavy', 'room-wind']);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// how far under full level the weather sits
const QUIET = 0.55;
// and out on the balcony, where nothing's in the way
const OPEN_AIR = 0.9;

// `hear` is room-window.js's: { rain, wind }, 0..1. `ear` is { near (metres to the glass), open (0..1, how
// much door you've got), out (on the balcony), annex (in the en-suite), storey }. Returns each bed's fraction.
export function windowMix(hear, ear) {
  const high = clamp01(((ear.storey || 1) - 1) / 22);
  // how much of what you hear is open air: all of it out there, some at an open door you're standing by
  const air = ear.annex ? 0 : ear.out ? 1 : clamp01(ear.open || 0) * Math.exp(-(ear.near ?? 99) / 3);
  const level = QUIET + (OPEN_AIR - QUIET) * air;
  const r = clamp01(hear.rain || 0), wet = r > 0.01 ? (0.32 + 0.68 * r) * throughGlass(ear) * level : 0;
  const heavy = clamp01((r - 0.4) / 0.5);
  // out in the wind the building doesn't shelter you, so height matters less
  const wind = clamp01(hear.wind || 0) ** 1.5 * Math.max(0.3 + 0.7 * high, 0.75 * air) * (ear.annex ? 0.1 : throughGlass(ear)) * level;
  return {
    'room-rain': wet * (1 - air),
    'room-rain-out': wet * air * (1 - heavy),
    'room-rain-heavy': wet * air * heavy,
    'room-wind': wind,
  };
}

// How much of the outside gets to you: all of it on the balcony or at an open door, a little under half
// across the room, almost none in the en-suite.
export function throughGlass(ear) {
  if (ear.annex) return 0.08;
  const close = Math.exp(-(ear.near ?? 99) / 5), open = ear.out ? 1 : clamp01(ear.open || 0);
  return 0.42 + 0.58 * Math.max(close, open);
}

// The birds and the surf from where you stand. `call` is a bird call's own level (room-outdoors.js gives
// it, falling off with the flock's distance), `surf` the shore's (0..1). Higher up, the street's birds are
// further off and the sea is further down, so both fall with the storey. Fractions, like windowMix.
export function outsideMix(call, surf, ear) {
  const up = 1 - 0.5 * clamp01(((ear.storey || 1) - 1) / 22), g = throughGlass(ear) * up;
  return { call: clamp01(call) * g, surf: clamp01(surf) * g * QUIET };
}
