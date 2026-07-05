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
  // Ground roll — tyres rumbling over the strip; gain rides ground-speed (silent airborne).
  const ROLL = { id: 'flt-roll', category: 'ambient', config: { gain: 1, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 230, q: 0.8 }, adsr: { a: 0.15, d: 0, s: 1, r: 0.3 }, gain: 0.11 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 540, q: 0.6 }, adsr: { a: 0.15, d: 0, s: 1, r: 0.3 }, gain: 0.05 },
  ] } };
  return { IDLE, POWER, WIND, ROLL };
}

let running = false, curClass = null;
let _smoothThr = 0, _smoothSpd = 0;

// ── Ambient weather bed (rides UNDER the engine drone) ────────────────────────
// A sustained loop that voices whatever's outside — rain on the canopy, a storm's
// roar, dry ash-hiss — cross-faded when the weather changes, its gain scaled by
// wind. Only while airborne (you hear the sky rush past). Plus the odd thunderclap.
const WEATHER_LOOP = {
  rain: { vol: 0.85, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1500, q: 0.5 }, adsr: { a: 1.2, d: 0, s: 1, r: 1.2 }, gain: 0.10 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 560, q: 0.7 }, adsr: { a: 1.2, d: 0, s: 1, r: 1.2 }, gain: 0.06 } ] },
  storm: { vol: 1.15, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1700, q: 0.4 }, adsr: { a: 1, d: 0, s: 1, r: 1 }, gain: 0.13 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 420, q: 0.7 }, adsr: { a: 1, d: 0, s: 1, r: 1 }, gain: 0.09 },
    { waveform: 'sine', freq: 58, adsr: { a: 1.4, d: 0, s: 1, r: 1 }, gain: 0.05 } ] },
  snow: { vol: 0.5, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 2600, q: 0.5 }, adsr: { a: 1.6, d: 0, s: 1, r: 1.4 }, gain: 0.05 } ] },
  ash: { vol: 0.7, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 480, q: 0.6 }, adsr: { a: 1.4, d: 0, s: 1, r: 1.2 }, gain: 0.08 } ] },
  fog: { vol: 0.4, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 260, q: 0.5 }, adsr: { a: 1.8, d: 0, s: 1, r: 1.6 }, gain: 0.05 } ] },
};
// Map the server's currentWeatherType strings onto our beds.
function weatherKey(w) {
  w = (w || '').toLowerCase();
  if (/storm|thunder|squall/.test(w)) return 'storm';
  if (/rain|drizzle|shower|sleet|wet/.test(w)) return 'rain';
  if (/snow|blizzard|flurr/.test(w)) return 'snow';
  if (/ash|dust|sand|smog/.test(w)) return 'ash';
  if (/fog|mist|haze/.test(w)) return 'fog';
  return null;   // clear / cloudy → silence
}
let curWeather = null, _stormT = 0;
function applyWeather(sky, airborne) {
  const ae = AE(); if (!ae) return;
  const key = airborne ? weatherKey(sky?.weather) : null;
  if (key !== curWeather) {
    if (curWeather) { ae.setLoopGain?.('flt-weather', 0, 0.7); setTimeout(() => { try { ae.stopLoop('flt-weather'); } catch {} }, 800); }
    curWeather = key;
    if (key) { try { ae.loopSound({ id: 'flt-weather', category: 'ambient', config: { gain: 1, layers: WEATHER_LOOP[key].layers } }); } catch {} ae.setLoopGain?.('flt-weather', 0, 0.1); }
  }
  if (key) {
    const wind = Math.min(1, (sky?.wind || 0) / 55);
    ae.setLoopGain?.('flt-weather', Math.min(0.9, (0.28 + wind * 0.5) * WEATHER_LOOP[key].vol), 1.0);
    // Occasional distant thunder in a storm.
    if (key === 'storm' && (_stormT = (_stormT + 1) % 5) === 0 && Math.random() < 0.5) {
      try { ae.playSfx?.({ config: { duration: 1.8, layers: [
        { waveform: 'sine', freq: 46, pitchBend: { to: 28, time: 1.6 }, filter: { type: 'lowpass', freq: 220, q: 1 }, adsr: { a: 0.05, d: 1.4, s: 0.2, r: 0.4 }, gain: 0.16 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 340, q: 0.6 }, adsr: { a: 0.02, d: 1.2, s: 0.1, r: 0.4 }, gain: 0.09 } ] } }); } catch {}
    }
  }
}

function startLoops(cls, engines) {
  const ae = AE(); if (!ae) return;
  ae.init?.();
  const L = buildLoops(cls, engines);
  try { ae.loopSound(L.IDLE); ae.loopSound(L.POWER); ae.loopSound(L.WIND); ae.loopSound(L.ROLL); } catch { /* no audio */ }
  ae.setLoopGain?.('flt-eng-idle', 0.0, 1.2); ae.setLoopGain?.('flt-eng-power', 0.0, 1.2); ae.setLoopGain?.('flt-wind', 0.0, 1.5); ae.setLoopGain?.('flt-roll', 0.0, 0.3);
  running = true; curClass = cls;
}
function killLoops(fast) {
  const ae = AE(); if (!ae) return;
  const ids = ['flt-eng-idle', 'flt-eng-power', 'flt-wind', 'flt-roll', 'flt-stallhorn', 'flt-weather'];
  ids.forEach(id => ae.setLoopGain?.(id, 0, fast ? 0.15 : 0.6));
  setTimeout(() => { try { ids.forEach(id => ae.stopLoop(id)); } catch {} }, fast ? 200 : 800);
  running = false; curClass = null; curWeather = null; _hornOn = false;
}

export function stopEngineAudio() { if (running) killLoops(false); }

// Ride the loop gains off the live HUD state. Called every cockpit_update.
export function updateEngineAudio(s) {
  const ae = AE(); if (!ae) return;
  if (!s || (!s.airborne && !s.engineOn)) { if (running) killLoops(false); return; }
  if (!running || curClass !== s.class) { if (running) { try { ['flt-eng-idle', 'flt-eng-power', 'flt-wind', 'flt-roll'].forEach(id => ae.stopLoop(id)); } catch {} } startLoops(s.class, s.engines?.length || 1); }
  const thr = (s.throttle || 0) / 100, spd = Math.min(1, (s.spd || 0) / 300);
  _smoothThr += (thr - _smoothThr) * 0.5; _smoothSpd += (spd - _smoothSpd) * 0.4;
  ae.setLoopGain?.('flt-eng-idle', (s.engineOn ? 0.55 : 0.2), 0.25);
  ae.setLoopGain?.('flt-eng-power', Math.min(1, 0.25 + _smoothThr * 0.9) * (s.airborne ? 1 : 0.5), 0.25);
  ae.setLoopGain?.('flt-wind', s.airborne ? Math.min(1, 0.2 + _smoothSpd + (s.bandIndex || 0) * 0.12) : 0.0, 0.3);
  // Ground roll — Mayfly only for now: rumble builds with taxi/roll speed, gone once airborne.
  const rollG = (!s.airborne && s.class === 'ultralight' && (s.spd || 0) > 1) ? Math.min(0.7, 0.12 + (s.spd || 0) / 55) : 0;
  ae.setLoopGain?.('flt-roll', rollG, 0.2);
  applyWeather(s.sky, !!s.airborne);
}

// ── Per-class start-up spool + shutdown spool-down ────────────────────────────
// A start-up is a little arc, not one tone: a starter bites, the core catches and
// lights off, then the whole thing winds up to idle. `pitchBend` sweeps (exp toward
// the target), staggered `delay`s sequence the phases, and a rising airflow hiss
// rides on top. Each class gets its own character — jet/turbine whine, turboshaft
// + rotor chop, a piston crank-and-catch, a two-stroke zip, a wreck's rough light.
const SPOOL_UP = {
  // Big turbofan: slow, heavy N2 whine climbing under a bright N1 whine, a low core
  // rumble, a light-off whoosh partway in, and swelling bypass airflow.
  heavy:   { duration: 2.8, layers: [
    { waveform: 'triangle', freq: 38,  pitchBend: { to: 520, time: 2.4 }, filter: { type: 'lowpass', freq: 2600, q: 1.4 }, adsr: { a: 0.25, d: 2.3, s: 0.5, r: 0.4 }, gain: 0.11 },   // N2 spool whine
    { waveform: 'sine',     freq: 140, pitchBend: { to: 880, time: 2.5 }, filter: { type: 'bandpass', freq: 1600, q: 1.2 }, adsr: { a: 0.5, d: 2.2, s: 0.5, r: 0.4 }, gain: 0.05 },    // N1 fan whine
    { waveform: 'sawtooth', freq: 28,  pitchBend: { to: 96, time: 2.0 }, filter: { type: 'lowpass', freq: 300, q: 1 }, adsr: { a: 0.3, d: 2.0, s: 0.6, r: 0.4 }, gain: 0.09 },        // core rumble
    { waveform: 'noise', noiseMix: 1, delay: 0.7, filter: { type: 'bandpass', freq: 700, q: 0.5 }, adsr: { a: 0.12, d: 0.7, s: 0.2, r: 0.4 }, gain: 0.08 },                          // light-off whoosh
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 1400, q: 0.7 }, adsr: { a: 0.9, d: 1.8, s: 0.4, r: 0.4 }, gain: 0.04 } ] },                                   // bypass airflow
  // Military turboshaft: quicker, harder, higher-pitched, with a bite of grit.
  gunship: { duration: 2.1, layers: [
    { waveform: 'triangle', freq: 60,  pitchBend: { to: 640, time: 1.7 }, filter: { type: 'lowpass', freq: 3000, q: 1.5 }, adsr: { a: 0.12, d: 1.7, s: 0.5, r: 0.3 }, gain: 0.10 },
    { waveform: 'square',   freq: 44,  pitchBend: { to: 150, time: 1.5 }, filter: { type: 'lowpass', freq: 900, q: 1.2 }, adsr: { a: 0.14, d: 1.5, s: 0.55, r: 0.3 }, gain: 0.06 },   // aggressive core
    { waveform: 'noise', noiseMix: 1, delay: 0.5, filter: { type: 'bandpass', freq: 1000, q: 0.6 }, adsr: { a: 0.08, d: 0.6, s: 0.2, r: 0.3 }, gain: 0.07 },                         // light-off
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 1500, q: 0.7 }, adsr: { a: 0.7, d: 1.4, s: 0.4, r: 0.3 }, gain: 0.04 } ] },
  // Helicopter: turboshaft whine winding up, and a rotor chop that fades in as the
  // blades come up to speed (steady thud via tremolo on a low-passed noise bed).
  heli:    { duration: 2.4, layers: [
    { waveform: 'triangle', freq: 30, pitchBend: { to: 340, time: 2.0 }, filter: { type: 'lowpass', freq: 900, q: 1.2 }, adsr: { a: 0.25, d: 2.0, s: 0.5, r: 0.4 }, gain: 0.11 },    // turbine whine
    { waveform: 'sine',     freq: 18, pitchBend: { to: 72, time: 2.1 }, adsr: { a: 0.4, d: 2.0, s: 0.5, r: 0.4 }, gain: 0.05 },                                                       // spool sub
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 380, q: 0.8 }, tremolo: { rate: 9, depth: 0.85 }, adsr: { a: 1.2, d: 1.4, s: 0.5, r: 0.5 }, gain: 0.08 } ] },  // rotor chop rising
  // Piston single: starter cranks (chugging square), the engine catches after a
  // beat, then revs up with an exhaust bark.
  prop:    { duration: 1.9, layers: [
    { waveform: 'square',   freq: 34, tremolo: { rate: 7, depth: 0.8 }, filter: { type: 'lowpass', freq: 380, q: 1 }, adsr: { a: 0.03, d: 0.6, s: 0.2, r: 0.15 }, gain: 0.10 },       // starter crank
    { waveform: 'sawtooth', freq: 26, pitchBend: { to: 150, time: 1.2 }, delay: 0.55, filter: { type: 'lowpass', freq: 800, q: 1 }, adsr: { a: 0.06, d: 1.1, s: 0.45, r: 0.25 }, gain: 0.12 },  // catch + rev
    { waveform: 'noise', noiseMix: 1, delay: 0.5, filter: { type: 'bandpass', freq: 280, q: 1 }, adsr: { a: 0.05, d: 1.0, s: 0.3, r: 0.25 }, gain: 0.06 } ] },                        // exhaust
  // Two-stroke ultralight: a quick, buzzy zip up to a high idle.
  ultralight: { duration: 1.1, layers: [
    { waveform: 'sawtooth', freq: 60, pitchBend: { to: 300, time: 0.9 }, tremolo: { rate: 11, depth: 0.35 }, filter: { type: 'lowpass', freq: 1400, q: 1 }, adsr: { a: 0.03, d: 0.9, s: 0.5, r: 0.2 }, gain: 0.11 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 1600, q: 0.7 }, adsr: { a: 0.1, d: 0.8, s: 0.3, r: 0.2 }, gain: 0.03 } ] },
  // Salvaged wreck: it doesn't want to start — a couple of dead coughs, then a
  // rough, uneven catch.
  wreck:   { duration: 2.0, layers: [
    { waveform: 'square', freq: 48, pitchBend: { to: 30, time: 0.4 }, adsr: { a: 0.02, d: 0.35, s: 0, r: 0.1 }, gain: 0.08 },                                                        // cough 1
    { waveform: 'square', freq: 54, delay: 0.55, pitchBend: { to: 34, time: 0.4 }, adsr: { a: 0.02, d: 0.35, s: 0, r: 0.1 }, gain: 0.08 },                                           // cough 2
    { waveform: 'sawtooth', freq: 24, delay: 1.0, pitchBend: { to: 118, time: 1.0 }, tremolo: { rate: 6, depth: 0.4 }, filter: { type: 'lowpass', freq: 600, q: 1 }, adsr: { a: 0.06, d: 0.9, s: 0.4, r: 0.3 }, gain: 0.11 },  // rough catch
    { waveform: 'noise', noiseMix: 1, delay: 1.0, filter: { type: 'bandpass', freq: 240, q: 1 }, adsr: { a: 0.05, d: 0.9, s: 0.2, r: 0.2 }, gain: 0.05 } ] },
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

// ── Ground contact + mechanical one-shots (Mayfly pass) ───────────────────────
// liftoff: wheels unweight and the tyres spin down as the strip drops away.
// touchdown: a rubber squeak/chirp as the wheels kiss the tarmac (+ a firmer thump on
// a harder arrival). flapWhir: the little electric actuator running the flaps.
const GROUND_FX = {
  liftoff: { config: { duration: 0.7, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 680, q: 0.8 }, adsr: { a: 0.02, d: 0.5, s: 0.1, r: 0.15 }, gain: 0.09 },   // tyre spin-down
    { waveform: 'sine', freq: 158, pitchBend: { to: 92, time: 0.5 }, adsr: { a: 0.03, d: 0.5, s: 0, r: 0.15 }, gain: 0.06 } ] } },                  // body unloads/floats
  touchdown: { config: { duration: 0.55, layers: [
    { waveform: 'sawtooth', freq: 840, pitchBend: { to: 430, time: 0.22 }, filter: { type: 'bandpass', freq: 1650, q: 7 }, adsr: { a: 0.006, d: 0.28, s: 0, r: 0.12 }, gain: 0.09 },  // squeak
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2500, q: 3 }, adsr: { a: 0.004, d: 0.18, s: 0, r: 0.08 }, gain: 0.045 },     // rubber scuff
    { waveform: 'square', freq: 64, pitchBend: { to: 42, time: 0.2 }, adsr: { a: 0.002, d: 0.22, s: 0, r: 0.08 }, gain: 0.06 } ] } },                // gear kiss
  touchdownHard: { config: { duration: 0.7, layers: [
    { waveform: 'sawtooth', freq: 700, pitchBend: { to: 360, time: 0.2 }, filter: { type: 'bandpass', freq: 1400, q: 6 }, adsr: { a: 0.004, d: 0.24, s: 0, r: 0.1 }, gain: 0.08 },   // scuffed squeal
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 700, q: 1 }, adsr: { a: 0.002, d: 0.4, s: 0, r: 0.12 }, gain: 0.12 },          // thud
    { waveform: 'square', freq: 54, pitchBend: { to: 34, time: 0.28 }, adsr: { a: 0.002, d: 0.3, s: 0, r: 0.1 }, gain: 0.11 } ] } },                  // gear slam
};
export function groundFx(kind) { const ae = AE(); const d = GROUND_FX[kind] || GROUND_FX.touchdown; try { ae?.init?.(); ae?.playSfx?.(d); } catch {} }

const FLAP_FX = { config: { duration: 0.5, layers: [
  { waveform: 'sawtooth', freq: 210, tremolo: { rate: 34, depth: 0.55 }, filter: { type: 'bandpass', freq: 880, q: 2 }, adsr: { a: 0.03, d: 0.42, s: 0.5, r: 0.1 }, gain: 0.05 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1200, q: 1.5 }, adsr: { a: 0.03, d: 0.42, s: 0.4, r: 0.1 }, gain: 0.022 } ] } };
export function flapWhir() { const ae = AE(); try { ae?.playSfx?.(FLAP_FX); } catch {} }

// Stall warning horn — a reedy buzzer that pulses on approach and goes continuous in the
// stall (per the sound doc). `level` 0..1 rides its gain; 0 lets go and stops the loop.
let _hornOn = false;
export function stallHorn(level) {
  const ae = AE(); if (!ae) return;
  if (level > 0 && !_hornOn) {   // start the buzzer once; the loop stays alive (killLoops stops it on close)
    try { ae.loopSound({ id: 'flt-stallhorn', category: 'ambient', config: { gain: 1, layers: [
      { waveform: 'square', freq: 520, filter: { type: 'bandpass', freq: 940, q: 3 }, adsr: { a: 0.02, d: 0, s: 1, r: 0.06 }, gain: 0.08 },
      { waveform: 'sawtooth', freq: 785, filter: { type: 'bandpass', freq: 1500, q: 4 }, adsr: { a: 0.02, d: 0, s: 1, r: 0.06 }, gain: 0.03 } ] } }); } catch {}
    _hornOn = true;
  }
  if (_hornOn) ae.setLoopGain?.('flt-stallhorn', Math.max(0, Math.min(0.6, level)), 0.05);   // pulse/steady via gain (no restart churn)
}
