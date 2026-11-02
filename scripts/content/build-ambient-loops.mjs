// The seven background loops (neon_rain, data_heist, explore_loop, dead_zone, ghost_signal,
// upper_deck, pulse_reactor), composed on scripts/audio/compose-lib.mjs and written as tracker
// songs over one shared palette, in the house style: 80s synth dance with a synthwave edge
// (docs/reference/game-music-craft.md#house-style-80s-synth-dance).
//
//   node scripts/content/build-ambient-loops.mjs           write the instrument and song files
//   node scripts/content/build-ambient-loops.mjs --check   fail if the files are behind this script
//   node scripts/audio/song-lint.mjs --module scripts/content/build-ambient-loops.mjs
//   node scripts/audio/song-render.mjs neon_rain --wav neon_rain.wav
//
// They replace hand-typed loops of the same names and ids: two or three channels, one velocity a
// channel, every note a row long, the same bar over and over (song-lint flagged all seven). Each
// is now a 32-bar loop in the form A A' B A'' (docs/reference/game-music-craft.md#form):
//   A    bass, kick and hats under the tune and the pad: the groove first
//   A'   the snare in, the tune's echo (a dotted eighth behind, quieter, the other side), the
//        sixteenth arp
//   B    the breakdown: new chords, half time, brass stabs, a second tune for four bars and then
//        the arp alone (call and response)
//   A''  everything, the clap on the backbeat, the tune varied, a tom fill into the loop point
// The bass is the loudest pitched thing in every song, straight eighths or a gallop, and the
// time is straight: synthwave sits on the grid. Velocities are humanised from a seed, so the
// files are the same every run.
//
// None of these is wired to a zone, a region or a broadcast today; they're the music player's
// and the dev panel's. Assigning one is a content decision (a region's `defaults.audio_theme_id`).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import { lint } from '../audio/song-lint.mjs';
import { Song, chord, scale, voiceLead, rng, motif, realise, vary, midi, stepBy, HAT_ACCENT } from '../audio/compose-lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

// ── the palette ─────────────────────────────────────────────────────────────
// The early-80s rig: detuned saws through a low-pass for pads, brass and bass (Juno, Jupiter,
// OB-Xa), a DX7 for the e-piano and bells, a LinnDrum-ish kit with a gated snare. No modulator
// sits at ratio 1 or 0.5 on anything that holds (docs/systems-hockey-sound.md: a sideband lands
// on 0 Hz). Levels are set by TRIM below.
const env = (a, d, s, r, curve) => ({ a, d, s, r, ...(curve ? { curve } : {}) });
const lp = (freq, q = 0.7) => ({ type: 'lowpass', freq, q });
const hp = (freq, q = 0.7) => ({ type: 'highpass', freq, q });
const bp = (freq, q = 0.8) => ({ type: 'bandpass', freq, q });
const cut = (id, cents, d, s = 0) => ({ id, type: 'env', a: 0.001, d, s, r: 0.08, curve: 'exp', to: [{ param: 'filter.cutoff', amount: cents }] });
const vib = (id, rate, cents, fade) => ({ id, type: 'lfo', wave: 'sine', rate, fade, to: [{ param: 'pitch', amount: cents }] });
const PALETTE = {
  // the bass: two saws a few cents apart and a square an octave down, through a resonant
  // low-pass that snaps open on every note. Eighths of this are most of the style.
  synthbass: { name: 'Loops: Synth bass', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -7, gain: 0.2, adsr: env(0.002, 0.18, 0.55, 0.06), filter: lp(320, 3.5), mods: [cut('op', 2600, 0.12, 0.15)] },
    { waveform: 'sawtooth', detune: 7, gain: 0.2, adsr: env(0.002, 0.18, 0.55, 0.06), filter: lp(320, 3.5), mods: [cut('op', 2400, 0.13, 0.15)] },
    { waveform: 'square', tune: -12, gain: 0.16, adsr: env(0.002, 0.2, 0.7, 0.06), filter: lp(260, 0.8) },
  ] },
  // the DX7's other bass: FM at 2:1 with the index on velocity, for the slower songs
  fmbass: { name: 'Loops: FM bass', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.36, adsr: env(0.003, 0.35, 0.55, 0.1, 'exp'), filter: lp(1200, 0.7),
      fm: { ratio: 2, index: 1.8, indexEnd: 0.35, time: 0.18, bright: 1.4 }, sub: { level: 0.4, octave: 1, wave: 'sine' } },
    { waveform: 'sawtooth', tune: 12, gain: 0.05, adsr: env(0.001, 0.03, 0, 0.02, 'exp'), filter: lp(2500, 0.8) },
  ] },
  epiano: { name: 'Loops: FM electric piano', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.2, adsr: env(0.002, 1.9, 0, 0.5, 'exp'), fm: { ratio: 14, index: 1.1, indexEnd: 0.04, time: 0.4, bright: 1.2 } },
    { waveform: 'sine', gain: 0.17, adsr: env(0.004, 2.4, 0.15, 0.6, 'exp'), fm: { ratio: 2, index: 0.35, indexEnd: 0.08, time: 0.6 } },
    { waveform: 'triangle', tune: 12, gain: 0.03, adsr: env(0.002, 0.5, 0, 0.3, 'exp') },
  ] },
  // the lead: saw and square apart, the filter well open, vibrato that arrives late
  lead: { name: 'Loops: Saw lead', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -8, gain: 0.1, adsr: env(0.008, 0.2, 0.75, 0.2), filter: lp(2600, 1.4),
      mods: [cut('bl', 1800, 0.25, 0.3), vib('vb', 5.4, 14, 0.4)] },
    { waveform: 'square', detune: 8, gain: 0.07, adsr: env(0.01, 0.2, 0.75, 0.2), filter: lp(3200, 0.8), mods: [vib('vb', 5.1, 12, 0.45)] },
    { waveform: 'sawtooth', tune: 12, detune: 3, gain: 0.025, adsr: env(0.01, 0.2, 0.7, 0.2), filter: lp(5000, 0.7) },
  ] },
  // the arp: a square pluck, short and bright, for sixteenths
  arp: { name: 'Loops: Square arp', waveform: 'square', layers: [
    { waveform: 'square', detune: -5, gain: 0.1, adsr: env(0.001, 0.14, 0, 0.06, 'exp'), filter: lp(900, 2.2), mods: [cut('op', 3200, 0.08)] },
    { waveform: 'sawtooth', detune: 6, gain: 0.06, adsr: env(0.001, 0.12, 0, 0.06, 'exp'), filter: lp(1400, 1), mods: [cut('op', 2400, 0.07)] },
  ] },
  // the pad: three saws spread wide, a slow filter sweep, chorus
  pad: { name: 'Loops: Analog pad', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -11, gain: 0.07, adsr: env(0.5, 0.5, 0.85, 1.2), filter: lp(1700, 0.9),
      mods: [{ id: 'sw', type: 'lfo', wave: 'triangle', rate: 0.11, to: [{ param: 'filter.cutoff', amount: 700 }] }],
      chorus: { rate: 0.5, depth: 0.4, delay: 0.016, mix: 0.5 } },
    { waveform: 'sawtooth', detune: 10, gain: 0.07, adsr: env(0.55, 0.5, 0.85, 1.2), filter: lp(1500, 0.8) },
    { waveform: 'sawtooth', tune: 12, detune: 2, gain: 0.025, adsr: env(0.6, 0.5, 0.85, 1.2), filter: lp(2400, 0.7) },
  ] },
  // the pumping pad: the same saws retriggered on every beat, cut off fast and swelling back in
  // over a tenth of a second, which is the sidechained pad without a sidechain. Retriggering
  // keeps it locked to the beat, where an LFO on `amp` would start wherever the note did.
  pump: { name: 'Loops: Pumping pad', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -11, gain: 0.07, adsr: env(0.11, 0.1, 0.9, 0.025), filter: lp(1900, 0.9),
      chorus: { rate: 0.5, depth: 0.4, delay: 0.016, mix: 0.5 } },
    { waveform: 'sawtooth', detune: 10, gain: 0.07, adsr: env(0.12, 0.1, 0.9, 0.025), filter: lp(1700, 0.8) },
    { waveform: 'sawtooth', tune: 12, detune: 2, gain: 0.025, adsr: env(0.12, 0.1, 0.9, 0.025), filter: lp(2600, 0.7) },
  ] },
  // poly brass for stabs: the filter blooms on the attack and closes
  brass: { name: 'Loops: Poly brass', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -9, gain: 0.11, adsr: env(0.015, 0.25, 0.6, 0.15), filter: lp(900, 1.3), mods: [cut('bl', 2800, 0.2, 0.25)] },
    { waveform: 'sawtooth', detune: 9, gain: 0.11, adsr: env(0.02, 0.25, 0.6, 0.15), filter: lp(1000, 1.1), mods: [cut('bl', 2500, 0.22, 0.25)] },
  ] },
  kick: { name: 'Loops: Kick', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.66, adsr: env(0.001, 0.34, 0, 0.06, 'exp'),
      mods: [{ id: 'dr', type: 'env', a: 0.001, d: 0.05, s: 0, r: 0.05, curve: 'exp', to: [{ param: 'pitch', amount: 2800 }] }] },
    { waveform: 'noise', noiseMix: 1, gain: 0.08, adsr: env(0.0005, 0.01, 0, 0.01, 'exp'), filter: bp(2500, 0.8), noiseSeed: 5 },
  ] },
  // the gated snare: a body, then noise held flat and cut off, the 1984 sound
  snare: { name: 'Loops: Gated snare', waveform: 'triangle', layers: [
    { waveform: 'triangle', gain: 0.26, adsr: env(0.0008, 0.07, 0, 0.04, 'exp'),
      mods: [{ id: 'tk', type: 'env', a: 0.001, d: 0.03, s: 0, r: 0.03, to: [{ param: 'pitch', amount: 600 }] }] },
    { waveform: 'noise', noiseMix: 1, gain: 0.3, adsr: env(0.0008, 0.03, 0.55, 0.035), filter: bp(2200, 0.55), noiseSeed: 17,
      echo: { mix: 0.18, delay: 0.07, feedback: 0.3 } },
    { waveform: 'noise', noiseMix: 1, gain: 0.12, adsr: env(0.0005, 0.06, 0, 0.03, 'exp'), filter: hp(6000, 0.7), noiseSeed: 19 },
  ] },
  clap: { name: 'Loops: Clap', waveform: 'square', layers: [
    { waveform: 'noise', noiseMix: 1, gain: 0.22, delay: 0, adsr: env(0.0005, 0.012, 0, 0.01, 'exp'), filter: bp(1300, 1.2), noiseSeed: 61 },
    { waveform: 'noise', noiseMix: 1, gain: 0.22, delay: 0.011, adsr: env(0.0005, 0.012, 0, 0.01, 'exp'), filter: bp(1300, 1.2), noiseSeed: 67 },
    { waveform: 'noise', noiseMix: 1, gain: 0.26, delay: 0.022, adsr: env(0.0005, 0.14, 0, 0.06, 'exp'), filter: bp(1200, 1), noiseSeed: 71 },
  ] },
  tom: { name: 'Loops: Synth tom', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.4, adsr: env(0.001, 0.35, 0, 0.08, 'exp'),
      mods: [{ id: 'dr', type: 'env', a: 0.001, d: 0.18, s: 0, r: 0.05, curve: 'exp', to: [{ param: 'pitch', amount: 900 }] }] },
    { waveform: 'noise', noiseMix: 1, gain: 0.05, adsr: env(0.0005, 0.04, 0, 0.02, 'exp'), filter: bp(900, 0.8), noiseSeed: 79 },
  ] },
  hat: { name: 'Loops: Hat', waveform: 'square', layers: [
    { waveform: 'noise', noiseMix: 1, gain: 0.13, adsr: env(0.0005, 0.035, 0, 0.02, 'exp'), filter: hp(7500, 0.7), noiseSeed: 41 },
    { waveform: 'square', gain: 0.03, adsr: env(0.0005, 0.03, 0, 0.02, 'exp'), filter: hp(6000, 0.7), fm: { ratio: 2.71, index: 3, indexEnd: 1.5, time: 0.03 } },
  ] },
  ohat: { name: 'Loops: Open hat', waveform: 'square', layers: [
    { waveform: 'noise', noiseMix: 1, gain: 0.1, adsr: env(0.0005, 0.25, 0, 0.1, 'exp'), filter: hp(7000, 0.6), noiseSeed: 43 },
    { waveform: 'square', gain: 0.025, adsr: env(0.0005, 0.2, 0, 0.08, 'exp'), filter: hp(6000, 0.7), fm: { ratio: 2.71, index: 3, indexEnd: 1.8, time: 0.2 } },
  ] },
};
// Trims, in dB, from measuring each instrument at 48 kHz against the kick and setting it where
// the house mix puts its role (game-music-craft.md#house-style-80s-synth-dance), each playing its
// usual figure: bass 2-3 dB over the kick, lead -2, snare -2, pad and arp -8, hats -10. Applied to
// every layer's gain, so the layers keep their balance.
const TRIM = { synthbass: 0, fmbass: -5, epiano: -9, lead: 2, brass: 2, snare: 7, clap: 11, tom: -1.5, hat: 10, ohat: 5, arp: 6 };
const INST_ID = (k) => `aud_inst_loop_${k}`;
// Drums play at one pitch; this is it. Toms take the fill's notes.
const DRUM_NOTE = { kick: 'C2', snare: 'D3', clap: 'D3', hat: 'C5', ohat: 'C5' };

// ── the kits and bass figures ───────────────────────────────────────────────
const KITS = {
  // four on the floor, eighth hats, the open hat on the off-beat: the dance floor
  four:  { kick: 'X...X...X...X...', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', ohat: '..x...x...x...x.' },
  // the same with sixteenth hats and a pickup kick: driving
  drive: { kick: 'X...X...X...X.x.', snare: '....X.......X...', hat: 'xxxxxxxxxxxxxxxx', ohat: '..x...x...x...x.' },
  // half time for the breakdown: the snare on three, the kick pushing
  half:  { kick: 'X.........X.....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.' },
};
// toms down the last half bar of each eight, into the next downbeat
const FILL = { rows: [8, 10, 12, 13, 14, 15], notes: ['G3', 'G3', 'D3', 'D3', 'A2', 'A2'] };
// root (r), octave (o), fifth (f), rest (.); each note gated a row short of the next
const BASS = {
  octave8: 'r.o.r.o.r.o.r.o.',     // the octave bounce
  drive8:  'r.r.r.r.r.r.r.r.',     // straight eighths on the root
  gallop:  'r.rrr.rrr.rrr.rr',     // the sixteenth gallop
  push:    'r.r.r.r.r.r.o.f.',     // eighths that climb into the next chord
};

// ── the songs ───────────────────────────────────────────────────────────────
// A section's chords are one per two bars (four to a section); B is the breakdown. Minor keys,
// the i-VI-III-VII family, straight time.
const SPECS = [
  { id: 'song_neon_rain', name: 'neon_rain', category: 'ambient', priority: 4, tempo: 100, swing: 0.5, seed: 'neon rain',
    key: 'D', mode: 'minor', A: ['Dm', 'Bb', 'F', 'C'], B: ['Gm', 'Bb', 'C', 'A'],
    lead: 'lead', arp: 'arp', bass: 'synthbass', anchor: 'A4', range: ['D4', 'F5'], density: 1,
    kit: { A: 'four', B: 'half' }, fig: { A: 'octave8', B: 'drive8' } },
  { id: 'song_data_heist', name: 'data_heist', category: 'cyberpunk', priority: 5, tempo: 112, swing: 0.5, seed: 'data heist',
    key: 'C#', mode: 'harmonicMinor', A: ['C#m', 'A', 'E', 'G#'], B: ['F#m', 'A', 'B', 'G#7'],
    lead: 'lead', arp: 'arp', bass: 'synthbass', anchor: 'G#4', range: ['C#4', 'F#5'], density: 1.3,
    kit: { A: 'drive', B: 'half' }, fig: { A: 'gallop', B: 'drive8' } },
  { id: 'song_explore_loop', name: 'explore_loop', category: 'ambient', priority: 4, tempo: 118, swing: 0.5, seed: 'explore',
    key: 'A', mode: 'minor', A: ['Am', 'F', 'C', 'G'], B: ['Dm', 'F', 'G', 'E'],
    lead: 'lead', arp: 'arp', bass: 'synthbass', anchor: 'E5', range: ['A4', 'A5'], density: 1.1,
    kit: { A: 'four', B: 'half' }, fig: { A: 'octave8', B: 'push' } },
  { id: 'song_dead_zone', name: 'dead_zone', category: 'ambient', priority: 3, tempo: 96, swing: 0.5, seed: 'dead zone',
    key: 'E', mode: 'phrygian', A: ['Em', 'F', 'Em', 'D'], B: ['C', 'F', 'G', 'F'],
    lead: 'brass', arp: 'arp', bass: 'synthbass', anchor: 'B4', range: ['E4', 'G5'], density: 0.7,
    kit: { A: 'half', B: 'half' }, fig: { A: 'drive8', B: 'drive8' } },
  { id: 'song_ghost_signal', name: 'ghost_signal', category: 'ambient', priority: 3, tempo: 104, swing: 0.5, seed: 'ghost signal',
    key: 'C', mode: 'minor', A: ['Cm', 'Ab', 'Eb', 'Bb'], B: ['Fm', 'Ab', 'Bb', 'G'],
    lead: 'epiano', arp: 'arp', bass: 'fmbass', anchor: 'G4', range: ['C4', 'Eb5'], density: 0.9,
    kit: { A: 'half', B: 'four' }, fig: { A: 'octave8', B: 'octave8' } },
  { id: 'song_upper_deck', name: 'upper_deck', category: 'ambient', priority: 4, tempo: 120, swing: 0.5, seed: 'upper deck',
    key: 'E', mode: 'minor', A: ['Em', 'C', 'G', 'D'], B: ['Am', 'C', 'D', 'B7'],
    lead: 'lead', arp: 'arp', bass: 'synthbass', anchor: 'B4', range: ['E4', 'G5'], density: 1.2,
    kit: { A: 'four', B: 'half' }, fig: { A: 'octave8', B: 'push' } },
  { id: 'aud_497cdcea-97e4-4e1a-99da-24e01577a849', name: 'pulse_reactor', category: 'cyberpunk', priority: 5, tempo: 124, swing: 0.5, seed: 'pulse reactor',
    key: 'A', mode: 'minor', A: ['Am', 'F', 'G', 'Em'], B: ['Dm', 'F', 'G', 'E7'],
    lead: 'lead', arp: 'arp', bass: 'synthbass', anchor: 'E5', range: ['A4', 'A5'], density: 1.5,
    kit: { A: 'drive', B: 'half' }, fig: { A: 'gallop', B: 'octave8' } },
];

const BARS = 32;
// [first bar, section, chords] for the four sections
const FORM = [[1, 'A'], [9, "A'"], [17, 'B'], [25, "A''"]];

function compose(spec) {
  const r = rng(spec.seed);
  const sc = scale(spec.key, spec.mode);
  // spell in flats when the scale has E♭ or B♭ and no F♯
  const flats = (sc.pcs.has(3) || sc.pcs.has(10)) && !sc.pcs.has(6);
  const song = new Song({ name: spec.name, tempo: spec.tempo, bars: BARS, swing: spec.swing, key: { flats }, master: 0.72 });
  const P = {
    lead: song.part('lead', spec.lead, { pan: 0.05 }),
    echo: song.part('echo', spec.lead, { pan: 0.4 }),
    arp: song.part('arp', spec.arp, { pan: -0.35 }),
    pad: [song.part('pad1', 'pad', { pan: -0.35 }), song.part('pad2', 'pad', { pan: 0 }), song.part('pad3', 'pad', { pan: 0.35 })],
    bass: song.part('bass', spec.bass, { pan: 0 }),
    kick: song.part('kick', 'kick', { pan: 0 }),
    snare: song.part('snare', 'snare', { pan: 0 }),
    clap: song.part('clap', 'clap', { pan: 0.1 }),
    tom: song.part('tom', 'tom', { pan: -0.2 }),
    hat: song.part('hat', 'hat', { pan: 0.3 }),
    ohat: song.part('ohat', 'ohat', { pan: 0.3 }),
  };
  const chordsOf = (sec) => (sec === 'B' ? spec.B : spec.A).map(chord);

  // the two tunes: M for the A sections, N for B. Two-bar motifs, one per chord.
  const M = motif(r, { rows: 32, density: spec.density, leapChance: 0.15 });
  const N = motif(r, { rows: 32, density: Math.max(0.5, spec.density * 0.7), leapChance: 0.1 });
  const phrase = (mo, sec) => [mo, vary(mo, r, 'answer'), vary(mo, r, sec === "A''" ? 'invert' : 'shift'), vary(mo, r, 'answer')];

  let voicing = null;
  for (const [bar0, sec] of FORM) {
    let anchor = midi(spec.anchor);
    const chords = chordsOf(sec);
    const kitName = sec === 'B' ? spec.kit.B : spec.kit.A;
    const kit = KITS[kitName];
    const tune = phrase(sec === 'B' ? N : M, sec);
    for (let c = 0; c < 4; c++) {
      const ch = chords[c], bar = bar0 + c * 2;
      // pad: voice-led triad held two bars (a fresh attack on the second bar of B for movement)
      voicing = voiceLead(ch, voicing, { lo: 'G3', hi: 'E5', n: 3 });
      if (sec === 'B') {
        // the breakdown's brass: stabs on one, the "and" of two, and four, both bars
        for (let b = 0; b < 2; b++) for (const [row, len, v] of [[0, 3, 0.8], [6, 2, 0.62], [12, 3, 0.7]]) {
          voicing.forEach((m, k) => P.pad[k].note(bar + b, row, m, len, v, { instrument: 'brass' }));
        }
      } else if (sec === 'A') voicing.forEach((m, v) => P.pad[v].note(bar, 0, m, 32, 0.55));
      // A' and A'': the pad pumps, a fresh attack on every beat, the downbeat a touch harder
      else for (let q = 0; q < 8; q++) voicing.forEach((m, v) => P.pad[v].note(bar + (q >> 2), (q & 3) * 4, m, 4, q % 4 ? 0.62 : 0.7, { instrument: 'pump' }));
      // bass: the figure under the chord's bass note, both bars
      const root = midi(`C2`) + ((ch.bass - 0 + 12) % 12);
      const low = root > midi('G2') ? root - 12 : root;
      for (let b = 0; b < 2; b++) {
        const fig = BASS[sec === 'B' ? spec.fig.B : spec.fig.A];
        const hits = [...fig].map((x, i) => [x, i]).filter(([x]) => x !== '.');
        hits.forEach(([x, i], k) => {
          const next = hits[k + 1]?.[1] ?? 16;
          const m = x === 'o' ? low + 12 : x === 'f' ? low + 7 : low;
          // the beat leads, the off-beat eighth is next, sixteenths in between ghost
          const accent = i % 4 === 0 ? 0.9 : i % 2 === 0 ? 0.74 : 0.6;
          P.bass.note(bar + b, i, m, Math.max(1, next - i - 1), accent);
        });
      }
      // the tune
      const play = sec !== 'B' || c < 2;          // B: two chords of tune, then the arp answers
      if (play) {
        // each two bars start where the last ended (a sequence, not a jump back to the anchor),
        // drawn back toward the anchor when they've wandered more than a fourth from it
        const notes = realise(tune[c], sc, ch, anchor, { lo: spec.range[0], hi: spec.range[1] });
        const end = notes[notes.length - 1].m, home = midi(spec.anchor);
        anchor = Math.abs(end - home) > 5 ? stepBy(end, end > home ? -2 : 2, sc) : end;
        notes.forEach((n, k) => {
          const strong = n.row % 8 === 0;
          const len = Math.max(1, Math.min(n.len - (n.len > 2 ? 1 : 0), 32 - n.row));
          // the last note of each phrase rings
          const last = k === notes.length - 1 && c % 2 === 1;
          P.lead.note(bar + Math.floor(n.row / 16), n.row % 16, n.m, last ? Math.max(len, 32 - n.row) : len, strong ? 0.8 : 0.66);
        });
      }
      // the arp: A' and A'' throughout, B's answer bars
      const arpOn = sec === "A'" || sec === "A''" || (sec === 'B' && c >= 2);
      if (arpOn) P.arp.arp(bar, 0, ch, { rows: 32, rate: 1, shape: sec === 'B' ? 'updown' : 'up', lo: 'A4', octaves: 2, vol: sec === 'B' ? 0.62 : 0.5 });
      // drums. A: kick and hats, no backbeat yet; A': the snare; B: half time; A'': the clap too.
      for (let b = 0; b < 2; b++) {
        const at = bar + b, fill = at % 8 === 0;
        P.kick.hits(at, kit.kick, DRUM_NOTE.kick, { scale: 0.95 });
        if (sec !== 'A') P.snare.hits(at, kit.snare, DRUM_NOTE.snare, { scale: 0.9 });
        if (sec === "A''") P.clap.hits(at, kit.snare, DRUM_NOTE.clap, { scale: 0.7 });
        P.hat.hits(at, kit.hat, DRUM_NOTE.hat, { scale: sec === 'A' ? 0.65 : 0.75, accent: HAT_ACCENT });
        if (kit.ohat && sec !== 'A') P.ohat.hits(at, kit.ohat, DRUM_NOTE.ohat, { scale: 0.5 });
        if (fill) {
          // the last half bar of each eight: toms down into the next downbeat, the hats out of the way
          for (let i = 8; i < 16; i++) P.hat.rows[P.hat.at(at, i)] = null;
          FILL.rows.forEach((row, k) => P.tom.note(at, row, FILL.notes[k], 1, 0.62 + 0.04 * k));
        }
      }
    }
  }
  // the echo: the tune three rows later, quieter, in A' and A'' only
  P.echo.echoOf(P.lead, { rows: 3, vol: 0.42, wrap: false });
  P.echo.clear(1, 8).clear(17, 24);
  // velocities move by a little; timing stays on the grid, as a sequencer's did
  for (const [k, p] of Object.entries(P)) {
    for (const part of Array.isArray(p) ? p : [p]) part.humanize(r, { vel: k === 'hat' ? 0.1 : 0.05 });
  }
  return song.toSong(spec.id, { instrumentId: INST_ID, category: spec.category, priority: spec.priority });
}

// Every layer names its waveform (the Rack writes one onto any that don't).
export const instruments = Object.entries(PALETTE).map(([key, def]) => ({
  id: INST_ID(key), name: def.name, category: 'loops', waveform: def.waveform, enabled: 1, sample_id: null,
  config: { layers: def.layers.map((l) => ({ waveform: def.waveform, ...l, gain: +(l.gain * Math.pow(10, (TRIM[key] || 0) / 20)).toFixed(4) })) },
}));
// Takes. Each song is composed TAKES times from seeds derived from its own, and the take the
// critic (scripts/audio/song-lint.mjs) marks best is kept: a lead near 65% steps (Huron's
// corpora run 60-75%), few leaps left hanging, the notes in the key, no warnings. The choice is
// a pure function of the specs, so the files are the same every run.
const TAKES = 12;
function grade(song) {
  const r = lint(song, Object.fromEntries(instruments.map((i) => [i.id, i])));
  const steps = r.lead?.steps ?? 0;
  const warns = r.findings.filter((f) => f.level === 'warn').length;
  const leaps = +(r.findings.find((f) => /big leaps/.test(f.msg))?.msg.match(/(\d+) big/)?.[1] ?? 0);
  return Math.abs(steps - 0.65) * 4 + leaps * 0.15 + warns * 2 + (1 - r.scaleFit) * 3;
}
export const songs = SPECS.map((spec) => {
  let best = null;
  for (let t = 0; t < TAKES; t++) {
    const song = compose({ ...spec, seed: `${spec.seed} #${t}` });
    const g = grade(song);
    if (!best || g < best.g) best = { song, g, t };
  }
  return best.song;
});
for (const s of songs) {
  s.channels.forEach((c, k) => c.forEach((st, i) => { if (st && i + (st.len || 1) > c.length) throw new Error(`${s.name} ch ${k}: ${st.note} at ${i} runs past the end`); }));
  for (const id of s.instrument_ids) if (!instruments.some((r) => r.id === id)) throw new Error(`${s.name}: no instrument ${id}`);
}

// ── write ───────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = [
    ...instruments.map((r) => [`content/audio_instruments/${r.id}.json`, r]),
    ...songs.map((s) => [`content/audio_songs/${s.id}.json`, s]),
  ];
  let stale = 0;
  for (const [rel, row] of files) {
    const p = path.join(ROOT, rel);
    const want = canonicalJson(row);
    const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (have === want) continue;
    stale++;
    if (CHECK) console.error(`✗ ${rel} is behind scripts/content/build-ambient-loops.mjs`);
    else { fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`); }
  }
  if (CHECK && stale) process.exit(1);
  for (const s of songs) {
    const notes = s.channels.reduce((n, c) => n + c.filter(Boolean).length, 0);
    console.log(`${CHECK ? '✓ up to date' : '✓ built'}: ${s.name}, ${s.channels.length} channels, ${notes} notes, ${BARS} bars at ${s.tempo} bpm (${(BARS * 16 * 60 / s.tempo / 4).toFixed(0)} s), swing ${s.swing ?? 0.5}`);
  }
}
