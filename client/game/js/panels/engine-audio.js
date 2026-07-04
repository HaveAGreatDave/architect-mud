// COCKPIT ENGINE AUDIO — the "you are occupying a real machine" layer.
//
// A live, sustained soundscape driven off the flight HUD state, wholly separate
// from the one-shot minigame cues. Three cross-faded loops through AudioEngine's
// loop bus (answers the Ambient slider): an idle rumble, a power/RPM layer whose
// gain tracks throttle, and a wind/slipstream bed that tracks airspeed + altitude.
//
// The timbre is PER AIRCRAFT CLASS — an ultralight buzzes, a heli clatters low, a
// heavy jet whines and roars, a wreck runs rough — so each type sounds distinct to
// the pilot, at start-up (spool) and in the cruise. Multi-engine craft get a
// thicker, beefier bed. Over the top ride airframe creaks, stress groans, gear
// clunks, and gust thumps. All guarded — silent if the audio engine isn't up.

function AE() { return window.AudioEngine; }

// Per-class engine character.
const CLASS_AUDIO = {
  ultralight: { idle: [78, 150], power: [190, 320], wave: 'sawtooth', nm: 0.5, wind: 1.15 },
  heli:       { idle: [40, 80],  power: [92, 150],  wave: 'triangle', nm: 0.42, wind: 0.9, sub: 1 },
  prop:       { idle: [52, 84],  power: [120, 190], wave: 'sawtooth', nm: 0.5, wind: 1.0 },
  heavy:      { idle: [36, 68],  power: [110, 215], wave: 'sawtooth', nm: 0.72, wind: 1.35, whine: 1 },
  gunship:    { idle: [58, 116], power: [165, 300], wave: 'square',   nm: 0.8, wind: 1.35, whine: 1 },
  wreck:      { idle: [47, 73],  power: [100, 150], wave: 'sawtooth', nm: 0.6, wind: 1.0, detune: 1 },
};
const prof = (cls) => CLASS_AUDIO[cls] || CLASS_AUDIO.prop;

function buildLoops(cls, engines) {
  const p = prof(cls);
  const beef = 1 + Math.min(0.6, Math.max(0, (engines || 1) - 1) * 0.18);
  const wf = p.whine ? 1.6 : 1;
  const IDLE = { id: 'flt-eng-idle', category: 'ambient', config: { gain: 1, layers: [
    { waveform: p.wave, freq: p.idle[0], filter: { type: 'lowpass', freq: 380 * wf, q: 2 }, adsr: { a: 0.5, d: 0, s: 1, r: 0.6 }, gain: 0.11 * beef },
    { waveform: p.wave, freq: p.idle[1], filter: { type: 'lowpass', freq: 520 * wf, q: 3 }, adsr: { a: 0.5, d: 0, s: 1, r: 0.6 }, gain: 0.05 * beef },
    ...(p.sub ? [{ waveform: 'sine', freq: p.idle[0] * 0.5, adsr: { a: 0.6, d: 0, s: 1, r: 0.6 }, gain: 0.055 }] : []),
    ...(p.detune ? [{ waveform: p.wave, freq: p.idle[0] * 1.03, filter: { type: 'lowpass', freq: 420, q: 2 }, adsr: { a: 0.5, d: 0, s: 1, r: 0.6 }, gain: 0.05 }] : []),
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 210, q: 0.7 }, adsr: { a: 0.6, d: 0, s: 1, r: 0.6 }, gain: 0.035 * p.nm },
  ] } };
  const POWER = { id: 'flt-eng-power', category: 'ambient', config: { gain: 1, layers: [
    { waveform: p.wave, freq: p.power[0], filter: { type: 'lowpass', freq: 1100 * wf, q: 2 }, adsr: { a: 0.3, d: 0, s: 1, r: 0.5 }, gain: 0.09 * beef },
    { waveform: p.whine ? 'square' : p.wave, freq: p.power[1], filter: { type: 'bandpass', freq: 900 * wf, q: 1.4 }, adsr: { a: 0.3, d: 0, s: 1, r: 0.5 }, gain: 0.045 * beef },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 700, q: 0.8 }, adsr: { a: 0.35, d: 0, s: 1, r: 0.5 }, gain: 0.05 * p.nm },
  ] } };
  const WIND = { id: 'flt-wind', category: 'ambient', config: { gain: 1, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 620, q: 0.5 }, adsr: { a: 0.8, d: 0, s: 1, r: 0.8 }, gain: 0.09 * p.wind },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 300, q: 0.6 }, adsr: { a: 0.8, d: 0, s: 1, r: 0.8 }, gain: 0.05 * p.wind },
  ] } };
  return { IDLE, POWER, WIND };
}

let running = false, curClass = null;
let _smoothThr = 0, _smoothSpd = 0;

function startLoops(cls, engines) {
  const ae = AE(); if (!ae) return;
  ae.init?.();
  const L = buildLoops(cls, engines);
  try { ae.loopSound(L.IDLE); ae.loopSound(L.POWER); ae.loopSound(L.WIND); } catch { /* no audio */ }
  ae.setLoopGain?.('flt-eng-idle', 0.0, 1.2); ae.setLoopGain?.('flt-eng-power', 0.0, 1.2); ae.setLoopGain?.('flt-wind', 0.0, 1.5);
  running = true; curClass = cls;
}
function killLoops(fast) {
  const ae = AE(); if (!ae) return;
  ['flt-eng-idle', 'flt-eng-power', 'flt-wind'].forEach(id => ae.setLoopGain?.(id, 0, fast ? 0.15 : 0.6));
  setTimeout(() => { try { ['flt-eng-idle', 'flt-eng-power', 'flt-wind'].forEach(id => ae.stopLoop(id)); } catch {} }, fast ? 200 : 800);
  running = false; curClass = null;
}

export function stopEngineAudio() { if (running) killLoops(false); }

// Ride the loop gains off the live HUD state. Called every cockpit_update.
export function updateEngineAudio(s) {
  const ae = AE(); if (!ae) return;
  if (!s || (!s.airborne && !s.engineOn)) { if (running) killLoops(false); return; }
  if (!running || curClass !== s.class) { if (running) { try { ['flt-eng-idle', 'flt-eng-power', 'flt-wind'].forEach(id => ae.stopLoop(id)); } catch {} } startLoops(s.class, s.engines?.length || 1); }
  const thr = (s.throttle || 0) / 100, spd = Math.min(1, (s.spd || 0) / 300);
  _smoothThr += (thr - _smoothThr) * 0.5; _smoothSpd += (spd - _smoothSpd) * 0.4;
  ae.setLoopGain?.('flt-eng-idle', (s.engineOn ? 0.55 : 0.2), 0.25);
  ae.setLoopGain?.('flt-eng-power', Math.min(1, 0.25 + _smoothThr * 0.9) * (s.airborne ? 1 : 0.5), 0.25);
  ae.setLoopGain?.('flt-wind', s.airborne ? Math.min(1, 0.2 + _smoothSpd + (s.bandIndex || 0) * 0.12) : 0.0, 0.3);
}

// ── Per-class start-up spool + shutdown spool-down ────────────────────────────
const SPOOL_UP = {
  heli:    { duration: 1.8, layers: [
    { waveform: 'triangle', freq: 16, pitchBend: { to: 78, time: 1.5 }, filter: { type: 'lowpass', freq: 420, q: 1 }, adsr: { a: 0.2, d: 1.3, s: 0.5, r: 0.3 }, gain: 0.14 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 300, q: 0.6 }, adsr: { a: 0.3, d: 1.2, s: 0.3, r: 0.3 }, gain: 0.06 } ] },
  heavy:   { duration: 2.0, layers: [
    { waveform: 'sawtooth', freq: 55, pitchBend: { to: 330, time: 1.8 }, filter: { type: 'lowpass', freq: 2400, q: 1.5 }, adsr: { a: 0.15, d: 1.6, s: 0.5, r: 0.3 }, gain: 0.12 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 900, q: 0.8 }, adsr: { a: 0.2, d: 1.6, s: 0.3, r: 0.3 }, gain: 0.05 } ] },
  gunship: { duration: 1.7, layers: [
    { waveform: 'square', freq: 70, pitchBend: { to: 400, time: 1.5 }, filter: { type: 'lowpass', freq: 2800, q: 1.5 }, adsr: { a: 0.1, d: 1.4, s: 0.5, r: 0.25 }, gain: 0.11 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 1100, q: 0.8 }, adsr: { a: 0.15, d: 1.4, s: 0.3, r: 0.25 }, gain: 0.05 } ] },
  prop:    { duration: 1.3, layers: [
    { waveform: 'sawtooth', freq: 24, pitchBend: { to: 120, time: 1.1 }, filter: { type: 'lowpass', freq: 700, q: 1 }, adsr: { a: 0.05, d: 1.0, s: 0.4, r: 0.25 }, gain: 0.13 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 260, q: 1 }, adsr: { a: 0.02, d: 0.9, s: 0.2, r: 0.2 }, gain: 0.06 } ] },
  ultralight: { duration: 1.0, layers: [
    { waveform: 'sawtooth', freq: 60, pitchBend: { to: 240, time: 0.9 }, filter: { type: 'lowpass', freq: 1200, q: 1 }, adsr: { a: 0.03, d: 0.8, s: 0.4, r: 0.2 }, gain: 0.11 } ] },
  wreck:   { duration: 1.5, layers: [
    { waveform: 'sawtooth', freq: 26, pitchBend: { to: 110, time: 1.2 }, filter: { type: 'lowpass', freq: 620, q: 1 }, adsr: { a: 0.05, d: 1.1, s: 0.3, r: 0.3 }, gain: 0.12 },
    { waveform: 'square', freq: 55, pitchBend: { to: 44, time: 0.6 }, adsr: { a: 0.02, d: 0.5, s: 0, r: 0.2 }, gain: 0.06 },   // misfire cough
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 240, q: 1 }, adsr: { a: 0.02, d: 1.0, s: 0.2, r: 0.2 }, gain: 0.06 } ] },
};
export function spoolUp(cls) { const ae = AE(); const d = SPOOL_UP[cls] || SPOOL_UP.prop; try { ae?.init?.(); ae?.playSfx?.({ config: d }); } catch {} }
export function spoolDown(cls) {
  const p = prof(cls); const ae = AE();
  const d = { duration: 1.2, layers: [
    { waveform: p.wave, freq: p.idle[1], pitchBend: { to: 22, time: 1.1 }, filter: { type: 'lowpass', freq: 500, q: 1 }, adsr: { a: 0.02, d: 1.0, s: 0.2, r: 0.2 }, gain: 0.11 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 300, q: 0.7 }, adsr: { a: 0.02, d: 1.0, s: 0.1, r: 0.2 }, gain: 0.05 } ] };
  try { ae?.playSfx?.(d); } catch {}
}

// ── One-shot airframe reactions ───────────────────────────────────────────────
const CREAKS = {
  creak: { config: { duration: 0.5, layers: [
    { waveform: 'triangle', freq: 190, pitchBend: { to: 120, time: 0.4 }, filter: { type: 'bandpass', freq: 300, q: 4 }, adsr: { a: 0.02, d: 0.35, s: 0, r: 0.1 }, gain: 0.09 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1400, q: 6 }, adsr: { a: 0.01, d: 0.2, s: 0, r: 0.08 }, gain: 0.04 } ] } },
  stress: { config: { duration: 0.7, layers: [
    { waveform: 'sawtooth', freq: 90, pitchBend: { to: 60, time: 0.6 }, filter: { type: 'lowpass', freq: 500, q: 2 }, adsr: { a: 0.03, d: 0.5, s: 0.2, r: 0.2 }, gain: 0.11 },
    { waveform: 'triangle', freq: 300, pitchBend: { to: 220, time: 0.5 }, filter: { type: 'bandpass', freq: 420, q: 5 }, adsr: { a: 0.02, d: 0.45, s: 0, r: 0.15 }, gain: 0.05 } ] } },
  gear: { config: { duration: 0.55, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 900, q: 1 }, adsr: { a: 0.002, d: 0.14, s: 0.3, r: 0.1 }, gain: 0.14 },
    { waveform: 'square', freq: 70, pitchBend: { to: 44, time: 0.4 }, adsr: { a: 0.002, d: 0.4, s: 0, r: 0.1 }, gain: 0.13 },
    { waveform: 'sine', freq: 160, delay: 0.35, adsr: { a: 0.002, d: 0.12, s: 0, r: 0.06 }, gain: 0.1 } ] } },
  gust: { config: { duration: 0.6, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 520, q: 0.7 }, adsr: { a: 0.08, d: 0.4, s: 0.1, r: 0.14 }, gain: 0.16 } ] } },
};
export function creak(kind = 'creak') {
  const ae = AE(); const def = CREAKS[kind] || CREAKS.creak;
  try { ae?.playSfx?.(def); } catch { /* no audio */ }
}
