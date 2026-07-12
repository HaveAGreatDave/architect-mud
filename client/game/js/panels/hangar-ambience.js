// HANGAR AMBIENCE — weather audio + animated sky FX for the hangar walk-inspect
// bay-door diorama. The door renderer (aircraft3d.drawInspectBayDoor) is a dumb,
// stateless painter; this module owns the *time-varying* half of the weather:
//
//   • the lightning schedule — a single source of truth shared by the visible
//     flash/bolt drawn through the door AND the thunderclap it triggers (so the
//     rumble always answers a bolt you actually saw), and
//   • the ambient weather bed — rain hiss / storm roar / dry ash / muffled fog,
//     cross-faded as the sky changes and swelling with the wind, so standing in
//     the open hangar in a downpour actually SOUNDS like it.
//
// Gated by the same WeatherFX/Motion setting as the rest of the client's weather
// (isWeatherFxEnabled) — "motion off" silences the bed and stills the lightning,
// keeping every weather effect under the one toggle.

import { isWeatherFxEnabled } from './weather-fx.js';

const AE = () => window.AudioEngine;
const LOOP_ID = 'hb-weather';
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

// weather string → bed key (mirrors engine-audio.js weatherKey so the hangar and
// the cockpit voice the same sky the same way).
function weatherKey(w) {
  w = (w || '').toLowerCase();
  if (/storm|thunder|squall/.test(w)) return 'storm';
  if (/rain|drizzle|shower|sleet|wet/.test(w)) return 'rain';
  if (/snow|blizzard|flurr/.test(w)) return 'snow';
  if (/ash|dust|sand|smog/.test(w)) return 'ash';
  if (/fog|mist|haze/.test(w)) return 'fog';
  return null;   // clear / cloudy → silence
}

// Ambient beds (a compact echo of engine-audio.js WEATHER_LOOP — filtered noise
// layers that read as precip on a roof, no engine drone under them here).
const WEATHER_LOOP = {
  rain: { vol: 0.8, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1500, q: 0.5 }, adsr: { a: 1.2, d: 0, s: 1, r: 1.2 }, gain: 0.10 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 560, q: 0.7 }, adsr: { a: 1.2, d: 0, s: 1, r: 1.2 }, gain: 0.06 } ] },
  storm: { vol: 1.1, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1700, q: 0.4 }, adsr: { a: 1, d: 0, s: 1, r: 1 }, gain: 0.13 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 420, q: 0.7 }, adsr: { a: 1, d: 0, s: 1, r: 1 }, gain: 0.09 },
    { waveform: 'sine', freq: 58, adsr: { a: 1.4, d: 0, s: 1, r: 1 }, gain: 0.05 } ] },
  snow: { vol: 0.45, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 2600, q: 0.5 }, adsr: { a: 1.6, d: 0, s: 1, r: 1.4 }, gain: 0.05 } ] },
  ash: { vol: 0.65, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 480, q: 0.6 }, adsr: { a: 1.4, d: 0, s: 1, r: 1.2 }, gain: 0.08 } ] },
  fog: { vol: 0.4, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 260, q: 0.5 }, adsr: { a: 1.8, d: 0, s: 1, r: 1.6 }, gain: 0.05 } ] },
};

let curKey = null;      // bed currently playing (null = silent)
let lastT = 0;          // performance.now()/1000 at the previous update
let flash = 0;          // full-door lightning flash 0..1, decays each frame
let bolt = null;        // { seg:[[x,y]…] in 0..1 door space, born, dur } while alive
let boltCd = 1.5;       // seconds until the next possible strike

// A jagged top-to-ground bolt in door-fraction space (x,y ∈ 0..1). The renderer
// maps it into the door's screen rect, so we stay resolution-independent.
function makeBolt() {
  let cx = 0.15 + Math.random() * 0.7, cy = 0;
  const seg = [[cx, cy]];
  while (cy < 0.66) {
    cy += 0.05 + Math.random() * 0.06;
    cx = clamp01(cx + (Math.random() - 0.5) * 0.13);
    seg.push([cx, cy]);
  }
  return { seg, born: performance.now(), dur: 240 };
}

// A thunderclap — a low rolling rumble over a noise crack, delayed a beat behind
// the flash (sound lags light) and softened for distance. Same voice family the
// windshield uses for near strikes.
function playThunder(intensity) {
  const ae = AE();
  if (!ae || !ae.playSfx) return;
  const near = clamp01(intensity);
  const delay = 220 + (1 - near) * 900;
  setTimeout(() => { try { ae.playSfx({ config: { duration: 1.2 + (1 - near) * 1.0, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 300 + near * 700, q: 0.7 }, adsr: { a: 0.003, d: 0.16 + (1 - near) * 0.22, s: 0.06, r: 0.3 }, gain: 0.11 + near * 0.14 },
    { waveform: 'sine', freq: 52, pitchBend: { to: 28, time: 1.1 }, filter: { type: 'lowpass', freq: 230, q: 1 }, adsr: { a: 0.02, d: 1.1, s: 0.16, r: 0.5 }, gain: 0.13 } ] } }); } catch {} }, delay);
}

// Advance the ambient bed toward the target weather, cross-fading on change and
// riding gain off the wind. Silent when key is null or the toggle's off.
function driveAudio(key, windKph) {
  const ae = AE();
  if (!ae) return;
  if (key !== curKey) {
    if (curKey) { try { ae.setLoopGain?.(LOOP_ID, 0, 0.6); } catch {} setTimeout(() => { try { ae.stopLoop(LOOP_ID); } catch {} }, 700); }
    curKey = key;
    if (key) {
      try { ae.init?.(); ae.loopSound({ id: LOOP_ID, category: 'ambient', config: { gain: 1, layers: WEATHER_LOOP[key].layers } }); } catch {}
      try { ae.setLoopGain?.(LOOP_ID, 0, 0.05); } catch {}
    }
  }
  if (key) {
    const windN = Math.min(1, (windKph || 0) / 40);
    try { ae.setLoopGain?.(LOOP_ID, Math.min(0.9, (0.3 + windN * 0.55) * WEATHER_LOOP[key].vol), 0.5); } catch {}
  }
}

// Called every animation frame from the hangar-bay loop while the walk-inspect
// door is on screen. `active` gates the whole thing (false ⇒ fade out + still).
// Returns the frame's visual FX state for the door renderer:
//   { motion, flash, bolt }  — motion=false ⇒ renderer skips animated weather.
export function updateHangarAmbience(sky, active) {
  const now = performance.now() / 1000;
  const dt = lastT ? Math.min(0.05, now - lastT) : 0;
  lastT = now;
  const on = active && isWeatherFxEnabled();
  const key = on ? weatherKey(sky?.weather) : null;
  driveAudio(key, sky?.wind);

  if (!on) { flash = 0; bolt = null; return { motion: false, flash: 0, bolt: null }; }

  // Lightning — only in a storm. Cadence tightens with the sky's wind (a proxy for
  // how hard it's blowing through); each strike lights the door and calls thunder.
  if (key === 'storm') {
    boltCd -= dt;
    if (boltCd <= 0) {
      bolt = makeBolt();
      const intensity = clamp01(0.4 + Math.min(1, (sky?.wind || 0) / 50) * 0.6);
      flash = 0.7 + 0.3 * intensity;
      playThunder(intensity);
      boltCd = 2.5 + Math.random() * 5;
    }
  } else { bolt = null; }
  flash = Math.max(0, flash - dt * 3.2);
  if (bolt && performance.now() - bolt.born > bolt.dur) bolt = null;
  return { motion: true, flash, bolt };
}

// Hard stop — call when the hangar bay closes (the render loop stops calling
// update(), so the bed would otherwise linger).
export function stopHangarAmbience() {
  const ae = AE();
  if (ae && curKey) { try { ae.setLoopGain?.(LOOP_ID, 0, 0.3); } catch {} setTimeout(() => { try { ae.stopLoop(LOOP_ID); } catch {} }, 400); }
  curKey = null; flash = 0; bolt = null; boltCd = 1.5;
}
