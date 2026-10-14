// THE DEADBALL SOUND BANK: the cues the Gameday views play, as data in SIREN's layer
// schema (client/shared/audio-engine.js buildLayer), on the 'tv' bus.
//
// Both Gameday views play these: the 2-D one (client/game/js/panels/gameday.js) and the
// 3-D one (gameday-grandstand.js), on the moments its director stages. The 3-D view's
// fuller bank grows here too (docs/proposals/deadball-glass2.md, Sound), so both views
// read one bank. Each cue is { category, priority, config }, the shape
// AudioEngine.playSfx takes.

export const DEADBALL_SFX = {
  mitt: { category: 'tv', priority: 2, config: { duration: 0.09, layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.07, gain: 0.13, filter: { type: 'lowpass', freq: 1100, q: 0.9 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 } },
    { waveform: 'sine', freq: 170, duration: 0.07, gain: 0.08, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 } },
  ] } },
  crack: { category: 'tv', priority: 4, config: { duration: 0.13, layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.045, gain: 0.34, filter: { type: 'highpass', freq: 2000, q: 0.7 }, adsr: { a: 0.0005, d: 0.04, s: 0, r: 0.02 } },
    { waveform: 'triangle', freq: 440, pitchBend: { to: 190, time: 0.05 }, duration: 0.1, gain: 0.24, filter: { type: 'bandpass', freq: 900, q: 1.1 }, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.05 } },
  ] } },
  whiff: { category: 'tv', priority: 3, config: { waveform: 'noise', noiseMix: 1, duration: 0.16, gain: 0.14, filter: { type: 'bandpass', freq: 1500, q: 0.5 }, adsr: { a: 0.03, d: 0.11, s: 0, r: 0.05 } } },
  // Ball smacking a fielder's glove out in the field — softer, rounder than the mitt.
  glove: { category: 'tv', priority: 3, config: { duration: 0.08, layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.06, gain: 0.11, filter: { type: 'lowpass', freq: 900, q: 0.8 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.02 } },
  ] } },
  base: { category: 'tv', priority: 4, config: { duration: 0.2, layers: [
    { waveform: 'sine', freq: 620, duration: 0.09, gain: 0.16, adsr: { a: 0.005, d: 0.08, s: 0, r: 0.05 } },
    { waveform: 'sine', freq: 830, delay: 0.085, duration: 0.12, gain: 0.16, adsr: { a: 0.005, d: 0.09, s: 0, r: 0.06 } },
  ] } },
  run: { category: 'tv', priority: 5, config: { duration: 0.34, layers: [
    { waveform: 'triangle', freq: 523, duration: 0.1, gain: 0.16, adsr: { a: 0.005, d: 0.09, s: 0, r: 0.06 } },
    { waveform: 'triangle', freq: 659, delay: 0.09, duration: 0.1, gain: 0.16, adsr: { a: 0.005, d: 0.09, s: 0, r: 0.06 } },
    { waveform: 'triangle', freq: 784, delay: 0.18, duration: 0.16, gain: 0.18, adsr: { a: 0.005, d: 0.12, s: 0, r: 0.08 } },
  ] } },
  homer: { category: 'tv', priority: 6, config: { duration: 0.6, layers: [
    { waveform: 'sawtooth', freq: 392, duration: 0.12, gain: 0.12, filter: { type: 'lowpass', freq: 2600, q: 0.8 }, adsr: { a: 0.005, d: 0.1, s: 0.2, r: 0.1 } },
    { waveform: 'triangle', freq: 523, delay: 0.1, duration: 0.14, gain: 0.16, adsr: { a: 0.005, d: 0.11, s: 0.1, r: 0.08 } },
    { waveform: 'triangle', freq: 659, delay: 0.22, duration: 0.16, gain: 0.16, adsr: { a: 0.005, d: 0.12, s: 0.1, r: 0.09 } },
    { waveform: 'triangle', freq: 880, delay: 0.34, duration: 0.26, gain: 0.2, vibrato: { rate: 6, depth: 8 }, adsr: { a: 0.005, d: 0.14, s: 0.3, r: 0.14 } },
  ] } },
  strikeout: { category: 'tv', priority: 4, config: { duration: 0.3, layers: [
    { waveform: 'sawtooth', freq: 392, pitchBend: { to: 196, time: 0.18 }, duration: 0.24, gain: 0.12, filter: { type: 'lowpass', freq: 1400, q: 1.4 }, adsr: { a: 0.005, d: 0.2, s: 0.1, r: 0.08 } },
  ] } },
  out: { category: 'tv', priority: 3, config: { duration: 0.14, layers: [
    { waveform: 'sine', freq: 210, duration: 0.1, gain: 0.14, adsr: { a: 0.002, d: 0.09, s: 0, r: 0.05 } },
    { waveform: 'noise', noiseMix: 1, duration: 0.04, gain: 0.06, filter: { type: 'lowpass', freq: 600, q: 0.8 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 } },
  ] } },
};
