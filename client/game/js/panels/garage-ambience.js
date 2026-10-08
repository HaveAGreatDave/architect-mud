// GARAGE AMBIENCE: the room under a service bay (panels/depot-shell.js), heard while the bay is up.
//
// A garage menu is never silent. Under the depot's bay there is a shed full of fitters, under the
// marina's a covered slip, under the hangar's a hangar. Each is one loop on the ambient bus: a
// low bed for the room, plus SIREN's sparkles (audio-engine.js `_startSparkles`) for the work going
// on in it, each a short one-shot on a randomised interval. The bed sits on the ambient slider like
// every other room sound, so turning the ambience down turns the garage down.
//
// ⚠ ONE BED AT A TIME, and the bay owns it: `garageBed(kind)` starts it when a bay opens and
// `garageBed(null)` stops it when the bay closes. Folding the bay keeps it: the shed is still round
// you. A weather bed through an open hangar door is hangar-ambience.js and is a separate loop.

const AE = () => window.AudioEngine;
const LOOP_ID = 'garage-bed';

const noise = (type, freq, q, gain, a = 1.4) => ({ waveform: 'noise', noiseMix: 1, filter: { type, freq, q }, adsr: { a, d: 0, s: 1, r: 1.2 }, gain });

// The work in the room. Each is { everyMin, everyMax, prob, gain, duration, layers }.
const RATCHET = { everyMin: 5, everyMax: 13, prob: 0.8, gain: 0.5, duration: 0.5, layers: [
  // An impact wrench: a buzzing pulse train under a hiss of air.
  { waveform: 'square', freq: 38, filter: { type: 'bandpass', freq: 900, q: 2.2 }, adsr: { a: 0.01, d: 0.3, s: 0.4, r: 0.12 }, gain: 0.05 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 3200, q: 0.7 }, adsr: { a: 0.005, d: 0.32, s: 0.2, r: 0.1 }, gain: 0.03 } ] };
const CLANK = { everyMin: 4, everyMax: 11, prob: 0.7, gain: 0.45, duration: 0.6, layers: [
  // A spanner set down on steel: two inharmonic partials and a tick.
  { waveform: 'sine', freq: 1730, adsr: { a: 0.001, d: 0.35, s: 0, r: 0.2 }, gain: 0.03 },
  { waveform: 'sine', freq: 2690, adsr: { a: 0.001, d: 0.2, s: 0, r: 0.12 }, gain: 0.02 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 5000, q: 2 }, adsr: { a: 0.001, d: 0.01, s: 0, r: 0.01 }, gain: 0.04 } ] };
const HISS = { everyMin: 9, everyMax: 22, prob: 0.6, gain: 0.4, duration: 0.9, layers: [
  // An air line bled off.
  noise('bandpass', 4200, 0.8, 0.04, 0.02) ] };
const CREAK = { everyMin: 6, everyMax: 14, prob: 0.7, gain: 0.4, duration: 1.0, layers: [
  // A mooring line taking up: a slow bend down through a narrow band.
  { waveform: 'sawtooth', freq: 190, pitchBend: { to: 150, time: 0.7 }, filter: { type: 'bandpass', freq: 620, q: 6 }, adsr: { a: 0.08, d: 0.6, s: 0, r: 0.2 }, gain: 0.03 } ] };
const KNOCK = { everyMin: 3, everyMax: 8, prob: 0.75, gain: 0.45, duration: 0.4, layers: [
  // Water on a hull in a slip.
  { waveform: 'sine', freq: 95, pitchBend: { to: 70, time: 0.12 }, adsr: { a: 0.005, d: 0.18, s: 0, r: 0.1 }, gain: 0.06 },
  noise('lowpass', 700, 0.7, 0.03, 0.01) ] };

const BEDS = {
  // The truck shed: a compressor's hum, fluorescent buzz, and the fitters.
  shed: { layers: [
    { waveform: 'sine', freq: 50, adsr: { a: 1.6, d: 0, s: 1, r: 1.2 }, gain: 0.035 },
    { waveform: 'sawtooth', freq: 100, filter: { type: 'lowpass', freq: 240, q: 0.7 }, adsr: { a: 1.6, d: 0, s: 1, r: 1.2 }, gain: 0.012 },
    noise('lowpass', 380, 0.6, 0.03) ],
    sparkle: [RATCHET, CLANK, HISS] },
  // The covered slip: water slapping in the dark, the roof's drip, ropes.
  dock: { layers: [
    noise('lowpass', 520, 0.6, 0.05),
    noise('bandpass', 1400, 0.4, 0.015) ],
    sparkle: [KNOCK, CREAK, CLANK] },
  // The hangar: a big room's low air, and the work a long way off.
  hangar: { layers: [
    noise('lowpass', 220, 0.5, 0.05, 2),
    { waveform: 'sine', freq: 44, adsr: { a: 2, d: 0, s: 1, r: 1.4 }, gain: 0.03 } ],
    sparkle: [{ ...RATCHET, gain: 0.3 }, { ...CLANK, gain: 0.3 }, HISS] },
};

let cur = null;
/** Start the bed for `kind` ('shed' | 'dock' | 'hangar'), or stop it with null. */
export function garageBed(kind) {
  const ae = AE();
  if (!ae || kind === cur) return;
  if (cur) ae.stopLoop(LOOP_ID);
  cur = BEDS[kind] ? kind : null;
  if (!cur) return;
  const b = BEDS[cur];
  ae.loopSound({ id: LOOP_ID, category: 'ambient', priority: 1, config: { gain: 1, layers: b.layers, sparkle: b.sparkle } });
}
