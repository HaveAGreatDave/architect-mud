// The preset sound effects (content/audio_sfx) and the ambient beds (content/audio_ambient),
// designed on scripts/audio/sfx-lib.mjs and levelled to their loudness targets.
//
//   node scripts/content/build-sfx.mjs            write the files
//   node scripts/content/build-sfx.mjs --check    fail if the files are behind this script
//   node scripts/audio/sfx-lint.mjs --module scripts/content/build-sfx.mjs   the critic on them
//
// They replace hand-typed presets of the same ids: 21 of the 26 were one oscillator through one
// envelope, ten of them a single pure partial, and fifteen of the 38 peaked over -1 dBFS on their
// own (sfx-lint, 2026-11-02). Each cue keeps its id, name, category and priority, so everything
// that plays one by name still does. The design notes are beside each cue; the method is in
// docs/reference/sfx-craft.md.
//
// LEVELLING. Every cue is rendered through the real engine and scaled, all layers together, so
// its loudness lands on its target (loudness-lib.mjs TARGETS: a one-shot's maximum momentary
// loudness, a bed's integrated loudness over its sustain; a one-shot that sounds for under a
// quarter of a second aims 4 LU lower), then pulled down further if that would peak over
// -1.5 dBFS. Balances inside a cue are the design's; its level is the target's.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import { cue, click, crack, tick, thump, knock, sub, ring, fmRing, buzz, servo, zap, whoosh, tail, rumble, rattle, blip, glitch, chime, air, crackle, hum, RATIOS } from '../audio/sfx-lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

// A transient as short as a shot or a punch reaches its peak long before it's loud: levelled by
// loudness alone it would need to peak several dB over full scale (the old presets did, and
// leaned on the master limiter). Driving its main layers is what a designer does instead: the
// clipper rounds the first peaks off and the sound gets denser at the same ceiling.
const driven = (amount, ...layers) => layers.flat(Infinity).map((l) => ({ ...l, drive: amount, driveType: 'soft' }));

// ── the presets ─────────────────────────────────────────────────────────────
const SFX = [
  // UI. Short, clean and tonal on purpose (an interface should sound designed), but never a bare
  // test tone: every one has an edge and a second partial.
  cue({ id: 'sfx_ui_hover', category: 'ui', duration: 0.012, layers: [
    blip({ freq: 2600, to: 2450, dur: 0.02, level: 0.2, bell: 0.15, edge: 0.3 }),
  ] }),
  cue({ id: 'sfx_ui_button', category: 'ui', duration: 0.02, layers: [
    // a key that goes down: a click, a small body, a short glassy tone
    click({ freq: 3800, q: 1.4, decay: 0.004, level: 0.35 }),
    knock({ freq: 320, decay: 0.03, level: 0.25 }),
    blip({ at: 0.004, freq: 1400, to: 1250, dur: 0.05, level: 0.3, bell: 0.3, edge: 0 }),
  ] }),
  cue({ id: 'sfx_ui_menu', category: 'ui', duration: 0.03, layers: [
    blip({ freq: 880, dur: 0.05, level: 0.25, bell: 0.25 }),
    blip({ at: 0.045, freq: 1319, dur: 0.07, level: 0.28, bell: 0.3 }),
  ] }),
  cue({ id: 'sfx_ui_confirm', category: 'ui', duration: 0.05, layers: [
    // up a fifth and ringing: yes
    chime({ notes: [1047, 1568], gap: 0.07, dur: 0.16, level: 0.3, bell: 0.5 }),
  ] }),
  cue({ id: 'sfx_ui_cancel', category: 'ui', duration: 0.05, layers: [
    // down a fourth, darker, shorter: no
    blip({ freq: 1175, dur: 0.06, level: 0.28, bell: 0.2 }),
    blip({ at: 0.065, freq: 880, to: 840, dur: 0.09, level: 0.28, bell: 0.15, edge: 0.05 }),
  ] }),
  cue({ id: 'sfx_ui_error', category: 'ui', duration: 0.08, layers: [
    // two buzzes a semitone apart, beating: wrong
    buzz({ freq: 196, dur: 0.07, level: 0.22, cutoff: 1400, q: 1, rough: 0.2 }),
    buzz({ freq: 208, dur: 0.07, level: 0.18, cutoff: 1600, q: 1, rough: 0.2 }),
    buzz({ at: 0.12, freq: 196, dur: 0.09, level: 0.22, cutoff: 1400, q: 1, rough: 0.2 }),
    buzz({ at: 0.12, freq: 208, dur: 0.09, level: 0.18, cutoff: 1600, q: 1, rough: 0.2 }),
    click({ freq: 2500, decay: 0.004, level: 0.25 }), click({ at: 0.12, freq: 2500, decay: 0.004, level: 0.25 }),
  ] }),
  cue({ id: 'sfx_ui_notification', category: 'ui', duration: 0.1, layers: [
    chime({ notes: [1319, 1976, 2637], gap: 0.075, dur: 0.22, level: 0.28, bell: 0.7 }),
    tail({ at: 0.02, decay: 0.3, freq: 6000, level: 0.03 }),
  ] }),

  // COMBAT. Impacts are a transient, a body and a tail, and they vary on every play: the same
  // hit ten times a fight must not be the same samples ten times.
  cue({ id: 'sfx_combat_hit', category: 'combat', priority: 7, duration: 0.05, layers: [
    // The crit flourish, played over the material hit (plugins/audio: enemy.attacked): a bright
    // shing of metal, a whump under it, and a sub drop that says it mattered.
    crack({ freq: 3200, q: 0.7, decay: 0.03, level: 0.45 }),
    fmRing({ at: 0.002, freq: 1480, ratio: 1.41, index: 5, indexEnd: 0.4, decay: 0.45, level: 0.22 }),
    fmRing({ at: 0.002, freq: 2230, ratio: 2.37, index: 2, indexEnd: 0.2, decay: 0.3, level: 0.1 }),
    thump({ freq: 62, from: 3.5, drop: 0.05, decay: 0.3, level: 0.55 }),
    knock({ freq: 200, decay: 0.08, level: 0.3 }),
    tail({ decay: 0.35, freq: 3500, level: 0.12 }),
  ] }),
  cue({ id: 'sfx_combat_critical', category: 'combat', priority: 7, duration: 0.06, layers: [
    // the same family a size up, with a low ring under it
    crack({ freq: 2800, q: 0.6, decay: 0.04, level: 0.5 }),
    fmRing({ at: 0.002, freq: 990, ratio: 1.41, index: 6, indexEnd: 0.3, decay: 0.7, level: 0.22 }),
    fmRing({ at: 0.002, freq: 1980, ratio: 3.5, index: 2.5, indexEnd: 0.2, decay: 0.4, level: 0.1 }),
    thump({ freq: 52, from: 4, drop: 0.06, decay: 0.45, level: 0.6 }), knock({ freq: 160, decay: 0.1, level: 0.35 }),
    sub({ freq: 38, decay: 0.6, level: 0.3 }), tail({ decay: 0.6, freq: 2500, level: 0.15 }),
  ] }),
  cue({ id: 'sfx_combat_death', category: 'combat', priority: 8, duration: 0.6, layers: [
    // A body going down: the knees, then the rest, the gear it was carrying, and a dark FM
    // sting falling under it, because in the vats a death is also an announcement.
    whoosh({ from: 300, to: 900, dur: 0.12, level: 0.15 }),
    thump({ at: 0.1, freq: 85, from: 2.5, drop: 0.03, decay: 0.15, level: 0.45 }), knock({ at: 0.1, freq: 240, decay: 0.05, level: 0.25 }),
    thump({ at: 0.24, freq: 58, from: 3, drop: 0.05, decay: 0.35, level: 0.65 }), knock({ at: 0.24, freq: 170, decay: 0.09, level: 0.35 }),
    rattle({ at: 0.27, count: 5, spacing: 0.03, freq: 2200, level: 0.18, seed: 41 }),
    rumble({ at: 0.24, freq: 160, decay: 0.5, level: 0.2 }),
    { waveform: 'sine', freq: 220, gain: 0.18, delay: 0.05, pitchBend: { to: 92, time: 0.7 },
      fm: { ratio: 2.01, index: 2.2, indexEnd: 0.6, time: 0.8 }, filter: { type: 'lowpass', freq: 2400, q: 0.8 },
      adsr: { a: 0.08, d: 0.9, s: 0, r: 0.4, curve: 'exp' } },
  ] }),
  cue({ id: 'sfx_combat_gunshot', category: 'combat', priority: 7, duration: 0.03, layers: [
    // front, body, mechanism, room. (Firearms in a fight go through the gunshot generator; this
    // is the preset for anything that names one.)
    driven(0.9, crack({ freq: 2600, q: 0.6, decay: 0.04, level: 0.6 }), thump({ freq: 88, from: 4, drop: 0.018, decay: 0.2, level: 0.6 })),
    crack({ freq: 6500, q: 0.8, decay: 0.012, level: 0.3 }),
    knock({ freq: 300, decay: 0.06, level: 0.35 }),
    click({ at: 0.004, freq: 3200, q: 2.5, decay: 0.008, level: 0.15 }),
    tail({ at: 0.015, decay: 0.8, freq: 1800, level: 0.42 }), sub({ freq: 46, decay: 0.3, level: 0.3 }),
  ] }),
  cue({ id: 'sfx_combat_punch', category: 'combat', duration: 0.02, layers: [
    // skin, then meat: a slap over a dull body that carries on a moment (a punch is short, and
    // a short sound has to be dense to read as heavy), the swing of the arm before it
    whoosh({ from: 600, to: 1400, dur: 0.05, level: 0.12 }),
    driven(0.6, crack({ freq: 1400, q: 1, decay: 0.035, level: 0.5 })),
    thump({ freq: 105, from: 2.6, drop: 0.02, decay: 0.16, level: 0.35 }),
    knock({ freq: 280, decay: 0.12, level: 0.5 }),
    { waveform: 'noise', noiseMix: 1, noise: 'pink', noiseSeed: 29, gain: 0.35, filter: { type: 'lowpass', freq: 1300, q: 0.9 }, adsr: { a: 0.001, d: 0.22, s: 0, r: 0.08, curve: 'exp' } },
  ] }),
  cue({ id: 'sfx_combat_slash', category: 'combat', duration: 0.12, layers: [
    // the swing, then the edge landing with a thin ring of steel
    // (the swing is noise, which peaks far above its level; driven, its peaks round off and it can
    // be as loud as a swing is without the cue going over the ceiling)
    driven(0.8, whoosh({ from: 500, to: 4200, dur: 0.15, q: 1.3, level: 0.6, colour: 'white' }), whoosh({ from: 300, to: 1200, dur: 0.15, q: 0.9, level: 0.3 })),
    driven(0.6, crack({ at: 0.12, freq: 3800, q: 0.9, decay: 0.045, level: 0.4 })),
    fmRing({ at: 0.12, freq: 3100, ratio: 1.41, index: 2, indexEnd: 0.2, decay: 0.25, level: 0.08 }),
    knock({ at: 0.12, freq: 420, decay: 0.04, level: 0.2 }),
  ] }),
  cue({ id: 'sfx_combat_stab', category: 'combat', duration: 0.05, layers: [
    // in: a short push of air, a wet crack and a dull body; then out
    whoosh({ from: 700, to: 1800, dur: 0.06, level: 0.15 }),
    driven(0.6, crack({ at: 0.05, freq: 1100, q: 1.2, decay: 0.065, level: 0.7 })),
    crack({ at: 0.05, freq: 3200, q: 1, decay: 0.02, level: 0.3 }),
    { waveform: 'noise', noiseMix: 1, noiseSeed: 9, gain: 0.45, delay: 0.055, filter: { type: 'bandpass', freq: 520, q: 4 },
      mods: [{ id: 'sq', type: 'env', a: 0.002, d: 0.08, s: 0, r: 0.04, to: [{ param: 'filter.cutoff', amount: -900 }] }],
      adsr: { a: 0.003, d: 0.1, s: 0, r: 0.05, curve: 'exp' } },
    thump({ at: 0.05, freq: 120, from: 2, drop: 0.02, decay: 0.09, level: 0.3 }),
    crack({ at: 0.2, freq: 700, q: 2, decay: 0.05, level: 0.15 }),
  ] }),
  cue({ id: 'sfx_combat_reload', category: 'combat', duration: 0.05, layers: [
    // magazine out, magazine in, the slide racked and slammed home
    click({ freq: 2200, q: 2, decay: 0.01, level: 0.35 }), knock({ freq: 380, decay: 0.03, level: 0.2 }),
    click({ at: 0.18, freq: 1800, q: 2, decay: 0.012, level: 0.4 }), knock({ at: 0.18, freq: 300, decay: 0.04, level: 0.3 }),
    whoosh({ at: 0.32, from: 1500, to: 3500, dur: 0.05, q: 3, level: 0.12, colour: 'white' }),
    ring({ at: 0.36, base: 1900, ratios: RATIOS.bar, decay: 0.12, level: 0.25, hardness: 0.95, strike: 0.5 }),
    knock({ at: 0.36, freq: 260, decay: 0.05, level: 0.35 }),
  ] }),

  // TV
  cue({ id: 'sfx_tv_relay_click', category: 'tv', duration: 0.01, layers: [
    // the contact, its bounce 7 ms later, and a tiny ring off the relay's spring
    click({ freq: 3500, q: 1.6, decay: 0.004, level: 0.4 }), click({ at: 0.007, freq: 4200, q: 2, decay: 0.003, level: 0.2 }),
    knock({ freq: 520, decay: 0.02, level: 0.2 }),
    ring({ base: 4100, ratios: [1, 2.32], decay: 0.03, level: 0.08, hardness: 1, strike: 0 }),
  ] }),
  cue({ id: 'sfx_tv_power_on', category: 'tv', duration: 0.25, layers: [
    // a CRT: the relay, the degauss thunk and hum, the tube's whine coming up, static settling
    click({ freq: 3000, decay: 0.004, level: 0.3 }),
    thump({ at: 0.01, freq: 60, from: 1.5, drop: 0.05, decay: 0.35, level: 0.45 }),
    { ...buzz({ at: 0.01, freq: 60, dur: 0.35, level: 0.2, cutoff: 500, q: 1, rough: 0.6 })[0], adsr: { a: 0.01, d: 0.35, s: 0, r: 0.1, curve: 'exp' } },
    { waveform: 'sine', freq: 3900, gain: 0.04, delay: 0.05, pitchBend: { to: 7860, time: 0.35 }, adsr: { a: 0.2, d: 0.3, s: 0.3, r: 0.2 } },
    { ...crackle({ freq: 4500, level: 0.25, density: 0.3, rate: 120 }), delay: 0.08, adsr: { a: 0.01, d: 0.35, s: 0, r: 0.1, curve: 'exp' } },
  ] }),
  cue({ id: 'sfx_tv_power_off', category: 'tv', duration: 0.12, layers: [
    // the picture collapsing to a dot: a falling zap, the relay, the hum dying
    { waveform: 'sine', freq: 1800, gain: 0.25, pitchBend: { to: 90, time: 0.12 }, fm: { ratio: 1.5, index: 2, indexEnd: 0.1, time: 0.15 },
      adsr: { a: 0.002, d: 0.18, s: 0, r: 0.05, curve: 'exp' } },
    click({ at: 0.005, freq: 2600, decay: 0.004, level: 0.3 }),
    { ...buzz({ freq: 60, dur: 0.2, level: 0.15, cutoff: 400, q: 1, rough: 0.3 })[0], adsr: { a: 0.002, d: 0.25, s: 0, r: 0.05, curve: 'exp' } },
    thump({ freq: 55, from: 1.3, drop: 0.08, decay: 0.2, level: 0.3 }),
  ] }),

  // CYBERPUNK: terminals, decks and the Architect. Synthetic on purpose, but each still has an
  // edge, a body and something after.
  cue({ id: 'sfx_terminal_boot', category: 'cyberpunk', duration: 0.5, layers: [
    click({ freq: 2800, decay: 0.006, level: 0.35 }), knock({ freq: 300, decay: 0.03, level: 0.2 }),
    servo({ at: 0.02, freq: 70, to: 260, dur: 0.6, level: 0.18, cutoff: 1100 }),
    rattle({ at: 0.15, count: 7, spacing: 0.035, freq: 3200, spread: 0.3, level: 0.15, seed: 13 }),
    blip({ at: 0.42, freq: 1000, dur: 0.12, level: 0.25, wave: 'square', bell: 0, edge: 0.1 }),
  ] }),
  cue({ id: 'sfx_terminal_login', category: 'cyberpunk', duration: 0.1, layers: [
    glitch({ count: 6, span: 0.1, lo: 1200, hi: 3200, level: 0.12, seed: 21 }),
    blip({ at: 0.11, freq: 880, to: 1320, dur: 0.12, level: 0.3, bell: 0.4 }),
    blip({ at: 0.2, freq: 1760, dur: 0.15, level: 0.22, bell: 0.5 }),
  ] }),
  cue({ id: 'sfx_terminal_logout', category: 'cyberpunk', duration: 0.1, layers: [
    blip({ freq: 1320, to: 660, dur: 0.12, level: 0.3, bell: 0.35 }),
    servo({ at: 0.06, freq: 220, to: 70, dur: 0.3, level: 0.12, cutoff: 900 }),
    click({ at: 0.32, freq: 2500, decay: 0.005, level: 0.25 }),
  ] }),
  cue({ id: 'sfx_hacking', category: 'cyberpunk', duration: 0.3, retro: { rate: 11025, bits: 7 }, layers: [
    // data being torn: a glitch storm, crunched, with an arc through it
    glitch({ count: 12, span: 0.35, lo: 300, hi: 4500, level: 0.16, seed: 33 }),
    zap({ at: 0.05, freq: 520, to: 900, dur: 0.18, level: 0.12 }),
    { ...crackle({ freq: 2500, level: 0.18, density: 0.25, rate: 160 }), adsr: { a: 0.01, d: 0.35, s: 0, r: 0.08, curve: 'exp' } },
    knock({ freq: 180, decay: 0.05, level: 0.2 }),
  ] }),
  cue({ id: 'sfx_scanner', category: 'cyberpunk', duration: 0.3, layers: [
    // a sweep up through the band, a hiss riding it, a lock at the top
    { waveform: 'sine', freq: 400, gain: 0.25, pitchBend: { to: 2400, time: 0.3 }, fm: { ratio: 2.01, index: 1.2, indexEnd: 3, time: 0.3 },
      ring: { ratio: 0.5, mix: 0.3 }, adsr: { a: 0.01, d: 0.35, s: 0.3, r: 0.08 } },
    whoosh({ from: 600, to: 5000, dur: 0.32, q: 3, level: 0.18, colour: 'white' }),
    blip({ at: 0.33, freq: 2093, dur: 0.08, level: 0.22, bell: 0.4 }),
  ] }),
  cue({ id: 'sfx_ice_break', category: 'cyberpunk', duration: 0.2, retro: { rate: 16000, bits: 8 }, layers: [
    // ICE shattering: glass, crunched to data
    crack({ freq: 4500, q: 0.6, decay: 0.05, level: 0.5 }),
    ring({ base: 1650, ratios: RATIOS.glass, decay: 0.5, level: 0.35, hardness: 0.95, strike: 0.3 }),
    ring({ at: 0.03, base: 2470, ratios: RATIOS.glass, decay: 0.35, level: 0.2, hardness: 0.95, strike: 0.2 }),
    rattle({ at: 0.04, count: 8, spacing: 0.025, freq: 5200, spread: 0.4, level: 0.18, seed: 55 }),
    glitch({ at: 0.06, count: 6, span: 0.2, lo: 800, hi: 4000, level: 0.1, seed: 57 }),
    thump({ freq: 90, from: 2, drop: 0.03, decay: 0.15, level: 0.35 }),
  ] }),
  cue({ id: 'sfx_architect_notice', category: 'cyberpunk', priority: 8, duration: 0.9, vary: null, layers: [
    // The Architect clearing its throat. A rising swell into a struck chord a tritone apart,
    // over a sub you feel. It was a 55 Hz sine and nothing else, which a laptop doesn't play.
    whoosh({ from: 200, to: 2400, dur: 0.45, q: 0.9, level: 0.18 }),
    { waveform: 'sawtooth', freq: 110, gain: 0.12, filter: { type: 'lowpass', freq: 500, q: 2 },
      mods: [{ id: 'op', type: 'env', a: 0.45, d: 1.2, s: 0, r: 0.4, to: [{ param: 'filter.cutoff', amount: 2400 }] }],
      adsr: { a: 0.4, d: 1.4, s: 0, r: 0.5, curve: 'exp' } },
    fmRing({ at: 0.45, freq: 220, ratio: 1.41, index: 3, indexEnd: 0.3, decay: 1.6, level: 0.3 }),
    fmRing({ at: 0.45, freq: 311.1, ratio: 1.41, index: 2.5, indexEnd: 0.3, decay: 1.4, level: 0.22 }),
    fmRing({ at: 0.45, freq: 880, ratio: 3.5, index: 1.5, indexEnd: 0.1, decay: 1.0, level: 0.12 }),
    sub({ at: 0.45, freq: 55, decay: 1.4, level: 0.35, from: 1.2 }),
    knock({ at: 0.45, freq: 140, decay: 0.15, level: 0.3 }),
  ] }),

  // ENVIRONMENT
  cue({ id: 'sfx_electrical_buzz', category: 'environment', duration: 0.18, layers: [
    // a short to ground: the arc, mains buzz around it, sparks crackling off it
    zap({ freq: 600, dur: 0.15, level: 0.2 }),
    driven(0.7, buzz({ freq: 120, dur: 0.28, level: 0.3, cutoff: 2500, rough: 0.6 })),
    { ...crackle({ freq: 4000, level: 0.18, density: 0.35, rate: 140 }), adsr: { a: 0.002, d: 0.3, s: 0, r: 0.06, curve: 'exp' } },
    click({ freq: 3000, decay: 0.004, level: 0.35 }),
  ] }),
];

// ── the beds ────────────────────────────────────────────────────────────────
// Held as long as a place wants them. Movement comes from slow smooth random sources on the
// cutoff and the level (sfx-lib `air`), texture from gated noise (`crackle`), and events from
// sparkles (one-shots the engine fires over the bed at random). Every bed has something that
// plays on a laptop: no bed is only sub-bass.
const sparkle = (layers, { every = [3, 8], gain = 1, duration = 0.2, jitter = 0.12, prob = 1 } = {}) => ({ everyMin: every[0], everyMax: every[1], gain, duration, jitter, prob, layers: layers.flat(Infinity).map((l) => ({ waveform: l.modes ? 'sine' : l.noiseMix >= 1 ? 'noise' : 'sine', ...l })) });
const BEDS = [
  cue({ id: 'amb_rain', category: 'environment', loop: true, priority: 1, layers: [
    air({ colour: 'pink', type: 'highpass', freq: 1400, q: 0.5, level: 0.3, move: 500, sway: 0.15, rate: 0.2 }),
    crackle({ freq: 4200, q: 0.6, level: 0.22, rate: 90, density: 0.22 }),
    air({ colour: 'brown', type: 'lowpass', freq: 400, q: 0.6, level: 0.25, move: 300, sway: 0.1, rate: 0.12 }),
  ], sparkle: [sparkle([crack({ freq: 2200, q: 1.2, decay: 0.02, level: 0.25 }), knock({ freq: 600, decay: 0.03, level: 0.1 })], { every: [0.6, 2], gain: 0.6 })] }),
  cue({ id: 'amb_heavy_rain', category: 'environment', loop: true, priority: 1, layers: [
    air({ colour: 'white', type: 'highpass', freq: 900, q: 0.5, level: 0.32, move: 400, sway: 0.2, rate: 0.3 }),
    crackle({ freq: 3000, q: 0.5, level: 0.3, rate: 140, density: 0.35 }),
    air({ colour: 'brown', type: 'lowpass', freq: 300, q: 0.7, level: 0.35, move: 400, sway: 0.25, rate: 0.15 }),
    crackle({ colour: 'pink', freq: 700, q: 1, level: 0.2, rate: 60, density: 0.3 }),
  ], sparkle: [sparkle([rumble({ freq: 90, decay: 2.5, level: 0.4 }), tail({ decay: 2, freq: 400, level: 0.2 })], { every: [14, 40], prob: 0.6, duration: 1.5 })] }),
  cue({ id: 'amb_wind', category: 'environment', loop: true, priority: 1, layers: [
    // gusts: the band and the level wander together, slowly; a whistle rides the top of them
    air({ colour: 'pink', type: 'bandpass', freq: 500, q: 0.9, level: 0.35, move: 1400, sway: 0.6, rate: 0.18 }),
    air({ colour: 'brown', type: 'lowpass', freq: 250, q: 0.7, level: 0.25, move: 300, sway: 0.4, rate: 0.12 }),
    { ...air({ colour: 'white', type: 'bandpass', freq: 1600, q: 9, level: 0.12, move: 900, sway: 0.8, rate: 0.22 }) },
  ] }),
  cue({ id: 'amb_fire', category: 'environment', loop: true, priority: 1, layers: [
    // the roar, the crackle and the odd pop
    air({ colour: 'brown', type: 'lowpass', freq: 500, q: 0.7, level: 0.35, move: 400, sway: 0.3, rate: 0.6 }),
    crackle({ freq: 2800, q: 0.8, level: 0.3, rate: 60, density: 0.09 }),
    crackle({ colour: 'pink', freq: 900, q: 1.2, level: 0.2, rate: 25, density: 0.12 }),
  ], sparkle: [sparkle([crack({ freq: 1800, q: 1, decay: 0.03, level: 0.4 }), knock({ freq: 300, decay: 0.04, level: 0.2 })], { every: [1, 4], gain: 0.7 })] }),
  cue({ id: 'amb_hvac', category: 'environment', loop: true, priority: 1, layers: [
    // air through a duct, the fan's blade tone, and a panel that rattles now and then
    air({ colour: 'pink', type: 'lowpass', freq: 1100, q: 0.6, level: 0.3, move: 200, sway: 0.08, rate: 0.1 }),
    hum({ freq: 110, level: 0.08, cutoff: 900, harmonics: 0.7, wobble: 6 }),
  ], sparkle: [sparkle(rattle({ count: 6, spacing: 0.04, freq: 1500, spread: 0.3, level: 0.2, seed: 61 }), { every: [8, 25], prob: 0.7, duration: 0.3 })] }),
  cue({ id: 'amb_generator', category: 'environment', loop: true, priority: 1, layers: [
    // a diesel at 1500 rpm: the firing pulse at 25 Hz shaking a saw through a low-pass, its
    // harmonics up where a laptop plays them, and mechanical noise on top
    { waveform: 'sawtooth', freq: 50, gain: 0.3, filter: { type: 'lowpass', freq: 600, q: 1.5 }, drive: 0.4, tremolo: { rate: 25, depth: 0.5 },
      adsr: { a: 1, d: 0.2, s: 1, r: 1 }, vibrato: { rate: 0.4, depth: 4 } },
    { waveform: 'square', freq: 100, gain: 0.08, filter: { type: 'bandpass', freq: 800, q: 1.2 }, tremolo: { rate: 25, depth: 0.6 }, adsr: { a: 1, d: 0.2, s: 1, r: 1 } },
    crackle({ colour: 'pink', freq: 2200, q: 1, level: 0.12, rate: 50, density: 0.5 }),
    air({ colour: 'brown', type: 'lowpass', freq: 200, level: 0.2, move: 100, sway: 0.1, rate: 0.3 }),
  ] }),
  cue({ id: 'amb_machinery', category: 'environment', loop: true, priority: 1, layers: [
    // a works: a motor, a press on a cycle, and metal clanking somewhere in it
    { waveform: 'sawtooth', freq: 73, gain: 0.18, filter: { type: 'lowpass', freq: 700, q: 2 }, vibrato: { rate: 11, depth: 10 }, adsr: { a: 1, d: 0.2, s: 1, r: 1 } },
    { waveform: 'noise', noiseMix: 1, noise: 'pink', noiseSeed: 71, gain: 0.25, filter: { type: 'bandpass', freq: 600, q: 1.5 }, adsr: { a: 1, d: 0.2, s: 1, r: 1 },
      mods: [{ id: 'pr', type: 'seq', rate: 2.4, steps: [1, 0.2, -0.6, -1, -1, -1, -0.4, 0.4], glide: true, to: [{ param: 'amp', amount: 0.9 }, { param: 'filter.cutoff', amount: 900 }] }] },
    air({ colour: 'brown', type: 'lowpass', freq: 180, level: 0.2, move: 100, sway: 0.1, rate: 0.2 }),
  ], sparkle: [sparkle([ring({ base: 420, ratios: RATIOS.plate, decay: 0.7, level: 0.3, hardness: 0.9, strike: 0.3 }), knock({ freq: 200, decay: 0.06, level: 0.3 })], { every: [2, 7], gain: 0.5, duration: 0.6, jitter: 0.25 })] }),
  cue({ id: 'amb_neon_hum', category: 'environment', loop: true, priority: 1, layers: [
    // a tube's 120 Hz buzz with a flicker in it, and the transformer's whine above
    { waveform: 'sawtooth', freq: 120, gain: 0.12, filter: { type: 'bandpass', freq: 1500, q: 1.2 }, adsr: { a: 1, d: 0.2, s: 1, r: 1 },
      mods: [{ id: 'fl', type: 'rand', rate: 9, density: 0.9, seed: 17, to: [{ param: 'amp', amount: 0.35 }] }] },
    hum({ freq: 120, level: 0.06, cutoff: 600, harmonics: 0.4, wobble: 1 }),
    { waveform: 'sine', freq: 7400, gain: 0.006, adsr: { a: 1, d: 0.2, s: 1, r: 1 }, vibrato: { rate: 0.2, depth: 6 } },
  ], sparkle: [sparkle([zap({ freq: 900, dur: 0.06, level: 0.2 }), click({ freq: 3000, decay: 0.004, level: 0.3 })], { every: [6, 20], prob: 0.6, gain: 0.5, duration: 0.08 })] }),
  cue({ id: 'amb_subway', category: 'environment', loop: true, priority: 1, layers: [
    // the train under you: rumble, the wheels over the joints, the rails squealing on a curve
    air({ colour: 'brown', type: 'lowpass', freq: 220, level: 0.4, move: 200, sway: 0.3, rate: 0.15 }),
    { waveform: 'noise', noiseMix: 1, noise: 'pink', noiseSeed: 73, gain: 0.45, filter: { type: 'bandpass', freq: 750, q: 1.4 }, adsr: { a: 1, d: 0.2, s: 1, r: 1 },
      mods: [{ id: 'jt', type: 'seq', rate: 6, steps: [1, -0.7, 0.8, -1, -1, -1, -1, -1], to: [{ param: 'amp', amount: 0.9 }] }] },
    { ...air({ colour: 'white', type: 'bandpass', freq: 3100, q: 14, level: 0.09, move: 300, sway: 0.95, rate: 0.08 }) },
    air({ colour: 'pink', type: 'bandpass', freq: 1400, q: 0.8, level: 0.12, move: 300, sway: 0.3, rate: 0.2 }),
  ] }),
  cue({ id: 'amb_tv_hum', category: 'tv', loop: true, priority: 1, layers: [
    hum({ freq: 60, level: 0.15, cutoff: 500, harmonics: 0.6, wobble: 1 }),
    { waveform: 'sine', freq: 7860, gain: 0.004, adsr: { a: 1, d: 0.2, s: 1, r: 1 } },
    air({ colour: 'pink', type: 'bandpass', freq: 2500, q: 0.8, level: 0.04, move: 200, sway: 0.1, rate: 0.3 }),
  ] }),
  cue({ id: 'amb_tv_static', category: 'tv', loop: true, priority: 1, layers: [
    air({ colour: 'white', type: 'bandpass', freq: 4000, q: 0.5, level: 0.3, move: 400, sway: 0.15, rate: 1.2 }),
    crackle({ freq: 2500, q: 0.7, level: 0.25, rate: 110, density: 0.25 }),
    hum({ freq: 60, level: 0.05, cutoff: 400, harmonics: 0.5, wobble: 1 }),
  ] }),
  cue({ id: 'amb_emergency_siren', category: 'environment', loop: true, priority: 2, layers: [
    // a wail from a few streets off: a saw rising and falling, a slower pair a few cents apart
    // for the beat between horns, and the echo off the buildings
    { waveform: 'sawtooth', freq: 700, gain: 0.15, filter: { type: 'lowpass', freq: 2200, q: 1 }, adsr: { a: 0.8, d: 0.2, s: 1, r: 1 },
      mods: [{ id: 'wl', type: 'lfo', wave: 'triangle', rate: 0.22, to: [{ param: 'pitch', amount: 800 }] }], echo: { mix: 0.25, delay: 0.32, feedback: 0.35 } },
    { waveform: 'square', freq: 704, gain: 0.05, filter: { type: 'lowpass', freq: 1800, q: 0.8 }, adsr: { a: 0.8, d: 0.2, s: 1, r: 1 },
      mods: [{ id: 'wl', type: 'lfo', wave: 'triangle', rate: 0.22, to: [{ param: 'pitch', amount: 800 }] }] },
  ] }),
];

// ── levelling ───────────────────────────────────────────────────────────────
// The existing files say what each cue is called and where it sits; this script says how it
// sounds. A cue whose file is missing keeps the defaults above.
const read = (dir, id) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', dir, `${id}.json`), 'utf8')); } catch { return null; } };
function keep(def, dir) {
  const old = read(dir, def.id);
  return old ? { ...def, name: old.name ?? def.name, category: old.category ?? def.category, priority: old.priority ?? def.priority } : def;
}
async function level(def) {
  const { installAudioGlobals } = await import('../audio/offline-audio.mjs');
  const { momentaryMax, kWeight, blocks, lufs, targetOf, soundLength } = await import('../audio/loudness-lib.mjs');
  installAudioGlobals();
  if (!globalThis.AudioEngine) new Function(fs.readFileSync(path.join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
  const AE = globalThis.AudioEngine;
  AE._setRetroUrl?.(path.join(ROOT, 'client/shared/audio-retro-worklet.js'));
  const SR = 48000, loop = !!def.loop;
  const measure = async (d) => {
    let render = d, seconds, from = 0;
    if (loop) { seconds = 1.3 + 3; from = Math.ceil(1.3 * SR); render = { ...d, config: { ...d.config, duration: seconds } }; }
    const buf = await AE.renderSfx(render, { sampleRate: SR, ...(seconds ? { seconds } : {}) });
    const x = buf.getChannelData(0);
    let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
    let lu;
    if (loop) { const z = blocks(kWeight(x, SR), SR, from).filter((m) => lufs(m) > -70); const mean = z.reduce((s, v) => s + v, 0) / z.length; lu = lufs(mean); }
    else lu = momentaryMax(x, SR);
    return { lu, peak, seconds: soundLength(x, SR) };
  };
  // (a short one-shot's target is lower: loudness-lib.mjs SHORT)
  const target = targetOf(loop ? 'loop' : 'sfx', def.category, loop ? Infinity : (await measure(def)).seconds);
  // Measured again after every step, because a driven layer isn't linear: more gain into its
  // clipper raises the peak by less, and the loudness by less again. Stops when a step would be
  // under 0.1 dB, so what's written is always something that was measured.
  let d = def;
  const ceil = Math.pow(10, -1.5 / 20);
  for (let pass = 0; pass < 8; pass++) {
    const { lu, peak } = await measure(d);
    let g = Math.pow(10, (target - lu) / 20);
    if (peak * g > ceil) g = ceil / peak;
    if (Math.abs(20 * Math.log10(g)) < 0.1 && peak <= ceil * 1.012) break;
    d = { ...d, config: { ...d.config, layers: d.config.layers.map((l) => ({ ...l, gain: +((l.gain ?? 1) * g).toPrecision(4) })) } };
  }
  return d;
}

export const sfx = await Promise.all(SFX.map((d) => level(keep(d, 'audio_sfx'))));
export const ambient = await Promise.all(BEDS.map((d) => level(keep(d, 'audio_ambient'))));

// ── write ───────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = [...sfx.map((r) => [`content/audio_sfx/${r.id}.json`, r]), ...ambient.map((r) => [`content/audio_ambient/${r.id}.json`, r])];
  let stale = 0;
  for (const [rel, row] of files) {
    const p = path.join(ROOT, rel);
    const want = canonicalJson(row);
    const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (have === want) continue;
    stale++;
    if (CHECK) console.error(`✗ ${rel} is behind scripts/content/build-sfx.mjs`);
    else { fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`); }
  }
  if (CHECK && stale) process.exit(1);
  console.log(`${CHECK ? '✓ up to date' : '✓ built'}: ${sfx.length} effects, ${ambient.length} beds`);
}
