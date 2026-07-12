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
  ultralight: { idle: [42, 60], power: [70, 100], wave: 'sawtooth', nm: 0.9, wind: 1.1, fs: 0.5, chug: 9 },   // deep low rumble (was a mid-tone "alarm")
  heli:       { idle: [40, 80],  power: [92, 150],  wave: 'triangle', nm: 0.42, wind: 0.9, sub: 1 },
  prop:       { idle: [52, 84],  power: [120, 190], wave: 'sawtooth', nm: 0.5, wind: 1.0 },
  heavy:      { idle: [36, 68],  power: [110, 215], wave: 'sawtooth', nm: 0.72, wind: 1.35, whine: 1 },
  gunship:    { idle: [58, 116], power: [165, 300], wave: 'square',   nm: 0.8, wind: 1.35, whine: 1 },
  wreck:      { idle: [47, 73],  power: [100, 150], wave: 'sawtooth', nm: 0.6, wind: 1.0, detune: 1 },
};
const prof = (cls) => CLASS_AUDIO[cls] || CLASS_AUDIO.prop;

// ── FlightEngine: a LIVE parameter-driven prop-engine synth (Mayfly) ──────────
// One persistent Web-Audio node graph whose AudioParams are ramped every update from the
// sim state — so the engine is a single continuous instrument (RPM/throttle/load/airspeed/
// ground), not discrete crossfaded loops. Layers: combustion core carrying the blade-passage
// pulse; airframe-vibration sub; FM prop-tip bite; engine airflow; wind; ground-roll rumble
// + rattle; a master tone-filter for interior/exterior + distance; a doppler scalar on the
// oscillator base frequencies. perspective/distance/doppler are HOOKS (default pilot-interior).
let _fe = null;
const _c01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const _cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Per-class VOICE for the parametric engine — shifts the same graph from a thin two-stroke
// buzz to a piston drone, a deep 4-turbofan roar, a hard jet howl, or a rough misfiring
// junker. coreB/coreS = combustion base freq + rpm span; wave = core timbre; pulseB/pulseS =
// blade-pass rate; pDep = [base,span] blade "whomp" depth (low = smooth turbine); biteB/biteS/
// biteM = prop-tip / turbine whine center+span+level; subB/subM = airframe sub freq+level; lpB/
// lpS = core low-pass sweep; crk = exhaust crackle; det = 2nd-osc detune (grit); mas = master trim.
// The `ultralight` row reproduces the Mayfly's existing hand-tuned numbers exactly (unchanged).
const FE_VOICE = {
  ultralight: { coreB: 38, coreS: 46, wave: 'sawtooth', pulseB: 28, pulseS: 22, pDep: [0.30, 0.35], biteB: 700,  biteS: 300,  biteM: 1.0, subB: 22, subM: 1.0, lpB: 220, lpS: 900,  crk: 1.0,  det: 1.007, mas: 1.0 },
  prop:       { coreB: 32, coreS: 58, wave: 'sawtooth', pulseB: 22, pulseS: 26, pDep: [0.24, 0.30], biteB: 600,  biteS: 340,  biteM: 1.1, subB: 19, subM: 1.3, lpB: 200, lpS: 1000, crk: 1.15, det: 1.008, mas: 1.05 },
  heavy:      { coreB: 20, coreS: 50, wave: 'sawtooth', pulseB: 30, pulseS: 30, pDep: [0.09, 0.14], biteB: 1050, biteS: 1700, biteM: 2.2, subB: 12, subM: 2.8, lpB: 260, lpS: 1700, crk: 0.4,  det: 1.005, mas: 1.3 },   // An-124: 4 D-18T turbofans — deep roar, huge lows, big turbine whine
  gunship:    { coreB: 30, coreS: 70, wave: 'sawtooth', pulseB: 36, pulseS: 40, pDep: [0.10, 0.15], biteB: 900,  biteS: 1400, biteM: 1.4, subB: 14, subM: 2.0, lpB: 300, lpS: 1500, crk: 0.45, det: 1.006, mas: 1.15 },   // A-10: twin TF34 turbofans — deep hum-growl + big lows, not a fighter scream
  wreck:      { coreB: 35, coreS: 40, wave: 'sawtooth', pulseB: 18, pulseS: 16, pDep: [0.34, 0.42], biteB: 540,  biteS: 260,  biteM: 0.9, subB: 23, subM: 1.0, lpB: 175, lpS: 680,  crk: 1.4,  det: 1.016, mas: 0.95 },
};
const voiceOf = (cls) => FE_VOICE[cls] || FE_VOICE.prop;

function createFlightEngine(cls) {
  try {
    const ae = AE(); if (!ae?.engineNodes) return null;
    const eng = ae.engineNodes(); if (!eng?.ctx || !eng.bus) return null;
    const { ctx, bus, noise } = eng;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} }
    const V = voiceOf(cls);
    const now = ctx.currentTime, src = [];
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; src.push(o); return o; };
    const noiseSrc = () => { const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true; src.push(n); return n; };
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q ?? 1; return b; };

    const master = gain(0);
    const toneFilter = filt('lowpass', 2600, 0.7);
    master.connect(toneFilter).connect(bus);

    // 1. combustion core + 2. prop blade pulse (LFO rides coreGain.gain around its base)
    const coreOsc = osc(V.wave, V.coreB), coreLP = filt('lowpass', V.lpB, 1.4), coreGain = gain(0.1);
    coreOsc.connect(coreLP).connect(coreGain).connect(master);
    const pulseLFO = osc('sine', V.pulseB), pulseDepth = gain(V.pDep[0]);
    pulseLFO.connect(pulseDepth).connect(coreGain.gain);

    // 3. body sub + airframe vibration (slow wander LFO on subGain)
    const subOsc = osc('sine', V.subB), subGain = gain(0.04);
    subOsc.connect(subGain).connect(master);
    const wanderLFO = osc('sine', V.rough ? 0.9 : 0.5), wanderDepth = gain(V.rough ? 0.05 : 0.02);
    wanderLFO.connect(wanderDepth).connect(subGain.gain);

    // 4. prop-tip bite (FM: mod → carrier.frequency)
    const biteCarrier = osc('sine', V.biteB), biteMod = osc('sine', 200), biteModGain = gain(40);
    biteMod.connect(biteModGain).connect(biteCarrier.frequency);
    const biteBP = filt('bandpass', 1600, 2), biteGain = gain(0);
    biteCarrier.connect(biteBP).connect(biteGain).connect(master);

    // 5. engine airflow
    const airHP = filt('highpass', 600, 0.7), airGain = gain(0.02);
    noiseSrc().connect(airHP).connect(airGain).connect(master);

    // 6. wind (independent of engine, ∝ airspeed)
    const windBP = filt('bandpass', 560, 0.5), windGain = gain(0);
    noiseSrc().connect(windBP).connect(windGain).connect(master);

    // 7. ground roll: rumble + rattle, gated by one rollGate (0 when airborne)
    const rollGate = gain(0); rollGate.connect(master);
    noiseSrc().connect(filt('lowpass', 210, 0.8)).connect(gain(0.3)).connect(rollGate);
    const rattleOsc = osc('square', 92), rattleLevel = gain(0.06);
    rattleOsc.connect(filt('bandpass', 300, 1.3)).connect(rattleLevel).connect(rollGate);
    const rattleLFO = osc('sine', 19), rattleTrem = gain(0.05);
    rattleLFO.connect(rattleTrem).connect(rattleLevel.gain);

    // 8. combustion richness — a slightly detuned 2nd oscillator beats against the core (grit;
    // wreck uses a wide detune for a rough, misfiring beat)
    const core2 = osc(V.wave, V.coreB * V.det); core2.connect(coreLP);
    // 9. exhaust crackle / two-stroke "brap" — noise chopped by a sawtooth LFO, level ∝ RPM
    const crBP = filt('bandpass', 750, 1.2), crTrem = gain(0.5), crLevel = gain(0);
    noiseSrc().connect(crBP).connect(crTrem).connect(crLevel).connect(master);
    const crLFO = osc('sawtooth', 12), crDepth = gain(0.5); crLFO.connect(crDepth).connect(crTrem.gain);
    // 10. stall buffet — low broadband roughening, level ∝ (1 − stall margin), airborne only
    const bfLP = filt('lowpass', 220, 1), bfTrem = gain(0.6), bfLevel = gain(0);
    noiseSrc().connect(bfLP).connect(bfTrem).connect(bfLevel).connect(master);
    const bfLFO = osc('sine', 5), bfDepth = gain(0.4); bfLFO.connect(bfDepth).connect(bfTrem.gain);
    // 11. ground-reflection lows — extra reflected bass on the deck that thins at liftoff ("lighter")
    const grefLP = filt('lowpass', 120, 1.2), grefGain = gain(0.02); coreLP.connect(grefLP).connect(grefGain).connect(master);
    // 12. throttle-chop backfire — a short exhaust pop, event-scheduled on a sharp throttle drop
    const popBP = filt('bandpass', 380, 1), popGain = gain(0); noiseSrc().connect(popBP).connect(popGain).connect(master);

    src.forEach(n => { try { n.start(now); } catch {} });
    master.gain.setValueAtTime(0, now); master.gain.linearRampToValueAtTime(V.mas, now + 0.8);   // swell in under the spool one-shot (per-class trim)

    return { ctx, master, toneFilter, voice: V, voiceCls: cls,
      core: { osc: coreOsc, lp: coreLP, gain: coreGain, pulseLFO, pulseDepth }, core2,
      sub: { osc: subOsc, gain: subGain },
      bite: { carrier: biteCarrier, modGain: biteModGain, bp: biteBP, gain: biteGain },
      air: { hp: airHP, gain: airGain }, wind: { bp: windBP, gain: windGain }, roll: { gate: rollGate },
      crackle: { level: crLevel }, buffet: { level: bfLevel }, gref: { gain: grefGain }, pop: { gain: popGain },
      _thrPrev: 0, _src: src };
  } catch { return null; }
}

// Ramp the graph from the live sim state. `s` = { rpm(0-1), throttle(0-100), airspeed(kt),
// vs(fpm), onGround, groundSpeed(kt), engineOn, perspective, distance, doppler }.
function updateFlightEngine(s) {
  const N = _fe; if (!N) return;
  const V = N.voice || FE_VOICE.ultralight;
  const now = N.ctx.currentTime, set = (p, v, tau) => { try { p.setTargetAtTime(v, now, tau); } catch {} };
  const thr = _c01((s.throttle || 0) / 100);
  const rpm = s.engineOn ? _c01(s.rpm != null ? s.rpm : (s.engines?.[0]?.pct || 0) / 100) : 0;
  const spdFrac = _c01((s.airspeed || 0) / 120), spdN = _c01((s.airspeed || 0) / 140);
  const load = _c01(0.4 + (s.vs || 0) / 1600 + (thr - spdFrac) * 0.3);   // climb ⇒ loaded (darker/heavier); descent ⇒ light
  const dop = s.doppler || 1;
  const ext = s.perspective === 'exterior';
  const windMul = ext ? 1.0 : 0.4, highsMul = ext ? 1.0 : 0.5, lowsMul = ext ? 1.0 : 1.2;
  const dist = _c01(s.distance || 0);

  set(N.core.osc.frequency, (V.coreB + rpm * V.coreS) * dop, 0.12);
  set(N.core.lp.frequency, Math.max(120, V.lpB + rpm * V.lpS - load * 260), 0.15);   // prop-load darkens
  set(N.core.gain.gain, 0.09 + rpm * 0.05, 0.10);
  set(N.core.pulseLFO.frequency, V.pulseB + rpm * V.pulseS, 0.12);                 // blade-pulse rate ∝ prop RPM
  set(N.core.pulseDepth.gain, V.pDep[0] + load * V.pDep[1], 0.20);                 // deeper "whomp" under load
  set(N.sub.osc.frequency, (V.subB + rpm * 6) * dop, 0.20);
  set(N.sub.gain.gain, (0.04 + load * 0.05) * lowsMul * V.subM, 0.20);
  set(N.bite.carrier.frequency, (V.biteB + rpm * V.biteS) * dop, 0.15);
  set(N.bite.modGain.gain, 40 + rpm * 120, 0.15);                                 // prop-tip whine brightens w/ RPM
  set(N.bite.bp.frequency, 1200 + rpm * 1400, 0.15);
  set(N.bite.gain.gain, rpm * 0.05 * highsMul * V.biteM, 0.15);
  set(N.air.gain.gain, 0.02 + rpm * 0.03 + spdN * 0.02, 0.20);
  set(N.air.hp.frequency, 500 + rpm * 700, 0.20);
  const flaps = _c01(s.flaps || 0);
  set(N.wind.gain.gain, spdN * 0.12 * windMul * (1 + flaps * 0.5), 0.30);         // wind ∝ airspeed (+ flaps); interior reduces
  set(N.wind.bp.frequency, 500 + spdN * 700, 0.30);
  set(N.roll.gate.gain, s.onGround ? _cl(0.1 + (s.groundSpeed || 0) / 60, 0, 0.4) : 0, 0.20);
  set(N.toneFilter.frequency, Math.max(400, (ext ? 9000 : 2600) * (1 - dist * 0.6)), 0.25);   // interior/exterior + distance
  // Enrichment layers
  set(N.core2.frequency, (V.coreB + rpm * V.coreS) * dop * V.det, 0.12);          // detuned unison beats against the core
  set(N.crackle.level.gain, rpm * 0.03 * V.crk * (ext ? 1.6 : 1), 0.15);          // exhaust crackle louder at power / outside
  set(N.buffet.level.gain, (s.airborne && !s.onGround) ? _c01(1 - (s.stallMargin ?? 1)) * 0.1 : 0, 0.15);   // stall buffet
  set(N.gref.gain.gain, s.onGround ? 0.05 : 0.008, 0.20);                          // reflected lows thin at liftoff
  // Throttle-chop backfire — a short pop scheduled on a sharp throttle reduction at power.
  if ((N._thrPrev - thr) > 0.28 && rpm > 0.25) {
    try { const g = N.pop.gain; g.cancelScheduledValues(now); g.setValueAtTime(0.09, now); g.linearRampToValueAtTime(0, now + 0.2); } catch {}
  }
  N._thrPrev = thr;
}

function stopFlightEngine(fast) {
  const fe = _fe; if (!fe) return; _fe = null;
  try {
    const { ctx, master, _src } = fe, now = ctx.currentTime, r = fast ? 0.15 : 0.6;
    master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now); master.gain.linearRampToValueAtTime(0, now + r);
    setTimeout(() => { try { _src.forEach(n => { try { n.stop(); } catch {} }); master.disconnect(); } catch {} }, (r + 0.1) * 1000);
  } catch {}
}

function buildLoops(cls, engines) {
  const p = prof(cls);
  const beef = 1 + Math.min(0.6, Math.max(0, (engines || 1) - 1) * 0.18);
  const wf = p.whine ? 1.6 : 1, fs = p.fs || 1;   // fs darkens the filters → low rumble, no mid "alarm" tone
  const chug = p.chug ? { tremolo: { rate: p.chug, depth: 0.22 } } : {};   // slow amplitude pulse = idling engine, not a steady tone
  const IDLE = { id: 'flt-eng-idle', category: 'ambient', config: { gain: 1, layers: [
    { waveform: p.wave, freq: p.idle[0], filter: { type: 'lowpass', freq: 380 * wf * fs, q: 2 }, ...chug, adsr: { a: 0.5, d: 0, s: 1, r: 0.6 }, gain: 0.11 * beef },
    { waveform: p.wave, freq: p.idle[1], filter: { type: 'lowpass', freq: 520 * wf * fs, q: 3 }, adsr: { a: 0.5, d: 0, s: 1, r: 0.6 }, gain: 0.05 * beef },
    ...(p.sub ? [{ waveform: 'sine', freq: p.idle[0] * 0.5, adsr: { a: 0.6, d: 0, s: 1, r: 0.6 }, gain: 0.055 }] : []),
    ...(p.detune ? [{ waveform: p.wave, freq: p.idle[0] * 1.03, filter: { type: 'lowpass', freq: 420, q: 2 }, adsr: { a: 0.5, d: 0, s: 1, r: 0.6 }, gain: 0.05 }] : []),
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 210 * fs, q: 0.7 }, adsr: { a: 0.6, d: 0, s: 1, r: 0.6 }, gain: 0.035 * p.nm },
  ] } };
  const POWER = { id: 'flt-eng-power', category: 'ambient', config: { gain: 1, layers: [
    { waveform: p.wave, freq: p.power[0], filter: { type: 'lowpass', freq: 1100 * wf * fs, q: 2 }, adsr: { a: 0.3, d: 0, s: 1, r: 0.5 }, gain: 0.09 * beef },
    { waveform: p.whine ? 'square' : p.wave, freq: p.power[1], filter: { type: 'bandpass', freq: 900 * wf * fs, q: 1.4 }, adsr: { a: 0.3, d: 0, s: 1, r: 0.5 }, gain: 0.045 * beef },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 700 * fs, q: 0.8 }, adsr: { a: 0.35, d: 0, s: 1, r: 0.5 }, gain: 0.05 * p.nm },
  ] } };
  const WIND = { id: 'flt-wind', category: 'ambient', config: { gain: 1, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 620, q: 0.5 }, adsr: { a: 0.8, d: 0, s: 1, r: 0.8 }, gain: 0.09 * p.wind },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 300, q: 0.6 }, adsr: { a: 0.8, d: 0, s: 1, r: 0.8 }, gain: 0.05 * p.wind },
  ] } };
  // Ground roll — tyres rumbling over the pavement + a light airframe rattle. The whole loop's
  // gain rides ground-speed (see updateEngineAudio), so both the rumble and the rattle build as
  // you accelerate down the strip, and it's silent once airborne.
  const ROLL = { id: 'flt-roll', category: 'ambient', config: { gain: 1, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 210, q: 0.8 }, tremolo: { rate: 7, depth: 0.3 }, adsr: { a: 0.15, d: 0, s: 1, r: 0.3 }, gain: 0.11 },   // wheel rumble (slow tremolo = pavement texture)
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 520, q: 0.6 }, adsr: { a: 0.15, d: 0, s: 1, r: 0.3 }, gain: 0.05 },                                    // tyre hiss
    { waveform: 'square', freq: 92, tremolo: { rate: 19, depth: 0.85 }, filter: { type: 'bandpass', freq: 300, q: 1.3 }, adsr: { a: 0.2, d: 0, s: 1, r: 0.3 }, gain: 0.03 },   // airframe rattle
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
// `s` = the cockpit state: { sky, airborne, spd, atmos:{windKt,turb} }. The bed is driven by
// the SAME sampled atmosphere the flight model uses — so the precip hiss swells with the gusts
// you feel and intensifies with airspeed (more weather hitting the canopy). Unified atmosphere.
function applyWeather(s) {
  const ae = AE(); if (!ae) return;
  const sky = s?.sky, airborne = !!s?.airborne;
  const key = airborne ? weatherKey(sky?.weather) : null;
  if (key !== curWeather) {
    if (curWeather) { ae.setLoopGain?.('flt-weather', 0, 0.7); setTimeout(() => { try { ae.stopLoop('flt-weather'); } catch {} }, 800); }
    curWeather = key;
    if (key) { try { ae.loopSound({ id: 'flt-weather', category: 'ambient', config: { gain: 1, layers: WEATHER_LOOP[key].layers } }); } catch {} ae.setLoopGain?.('flt-weather', 0, 0.1); }
  }
  if (key) {
    const atmos = s.atmos || {};
    const windN = Math.min(1, (atmos.windKt || sky?.wind || 0) / 40);   // gust-inclusive → the bed pulses with gusts
    const spdN = Math.min(1, (s.spd || 0) / 200);                        // faster = more precip on the canopy
    ae.setLoopGain?.('flt-weather', Math.min(0.95, (0.24 + windN * 0.5 + spdN * 0.3) * WEATHER_LOOP[key].vol), 0.6);
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

export function stopEngineAudio() { if (running) killLoops(false); stopFlightEngine(false); }

// Ride the engine sound off the live HUD state. Called every cockpit update (~4/s).
export function updateEngineAudio(s) {
  const ae = AE(); if (!ae) return;
  if (!s || (!s.airborne && !s.engineOn)) { if (running) killLoops(false); stopFlightEngine(false); return; }

  // Continuous cockpit (the fixed-wing fleet) → the live parametric FlightEngine synth, voiced
  // per class; deck craft (the heli) → static crossfaded loops.
  if (s.continuous) {
    if (running) killLoops(false);                 // ensure the generic loops aren't also playing
    if (!_fe || _fe.voiceCls !== s.class) { if (_fe) stopFlightEngine(true); _fe = createFlightEngine(s.class); }
    updateFlightEngine(s);
    applyWeather(s);
    return;
  }
  if (_fe) stopFlightEngine(false);                // switched to a deck craft

  if (!running || curClass !== s.class) { if (running) { try { ['flt-eng-idle', 'flt-eng-power', 'flt-wind', 'flt-roll'].forEach(id => ae.stopLoop(id)); } catch {} } startLoops(s.class, s.engines?.length || 1); }
  const thr = (s.throttle || 0) / 100, spd = Math.min(1, (s.spd || 0) / 300);
  _smoothThr += (thr - _smoothThr) * 0.5; _smoothSpd += (spd - _smoothSpd) * 0.4;
  ae.setLoopGain?.('flt-eng-idle', (s.engineOn ? 0.55 - _smoothThr * 0.28 : 0.2), 0.25);   // fade idle down as power rises (clean crossfade, no double prop-pulse beat)
  ae.setLoopGain?.('flt-eng-power', Math.min(1, 0.25 + _smoothThr * 0.9) * (s.airborne ? 1 : 0.5), 0.25);
  ae.setLoopGain?.('flt-wind', s.airborne ? Math.min(1, 0.2 + _smoothSpd + (s.bandIndex || 0) * 0.12) : 0.0, 0.3);
  ae.setLoopGain?.('flt-roll', 0, 0.2);            // ground roll is handled by FlightEngine (Mayfly); loop path stays silent
  applyWeather(s);
}

// ── Per-class start-up spool + shutdown spool-down ────────────────────────────
// A start-up is a little arc, not one tone: a starter bites, the core catches and
// lights off, then the whole thing winds up to idle. `pitchBend` sweeps (exp toward
// the target), staggered `delay`s sequence the phases, and a rising airflow hiss
// rides on top. Each class gets its own character — jet/turbine whine, turboshaft
// + rotor chop, a piston crank-and-catch, a two-stroke zip, a wreck's rough light.
const SPOOL_UP = {
  // Big turbofan (An-124 D-18T): a slow, massive N2 whine climbing under a bright N1
  // whine, a deep core rumble, a light-off whoosh partway in, and swelling bypass airflow.
  heavy:   { duration: 3.4, layers: [
    { waveform: 'triangle', freq: 34,  pitchBend: { to: 520, time: 3.0 }, filter: { type: 'lowpass', freq: 2600, q: 1.4 }, adsr: { a: 0.3, d: 2.9, s: 0.5, r: 0.5 }, gain: 0.12 },    // N2 spool whine
    { waveform: 'sine',     freq: 130, pitchBend: { to: 900, time: 3.1 }, filter: { type: 'bandpass', freq: 1600, q: 1.2 }, adsr: { a: 0.6, d: 2.8, s: 0.5, r: 0.5 }, gain: 0.06 },    // N1 fan whine
    { waveform: 'sawtooth', freq: 22,  pitchBend: { to: 92, time: 2.6 }, filter: { type: 'lowpass', freq: 280, q: 1 }, adsr: { a: 0.35, d: 2.6, s: 0.6, r: 0.5 }, gain: 0.13 },       // deep core rumble
    { waveform: 'noise', noiseMix: 1, delay: 0.9, filter: { type: 'bandpass', freq: 640, q: 0.5 }, adsr: { a: 0.14, d: 0.9, s: 0.2, r: 0.4 }, gain: 0.09 },                          // light-off whoosh
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 1400, q: 0.7 }, adsr: { a: 1.1, d: 2.3, s: 0.45, r: 0.5 }, gain: 0.05 } ] },                                  // bypass airflow
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
  // Engine start (per the FM brief): a dry electric starter whine rises with mounting FM
  // complexity and a slight pitch flutter, metallic gear chatter from a lightly modulated
  // operator, filtered-noise compressor airflow, and — ~60% through — a low combustion
  // rumble fades in carrying the blade pulse, so it settles into idle rather than stopping.
  ultralight: { duration: 2.2, layers: [
    { waveform: 'sine', freq: 170, pitchBend: { to: 500, time: 1.6 }, fm: { rate: 340, depth: 110 }, filter: { type: 'bandpass', freq: 1500, q: 1.3 }, vibrato: { rate: 7, depth: 9 }, adsr: { a: 0.05, d: 1.9, s: 0.45, r: 0.35 }, gain: 0.06 },   // starter whine (rising, FM, flutter)
    { waveform: 'square', freq: 64, fm: { rate: 184, depth: 80 }, tremolo: { rate: 15, depth: 0.85 }, filter: { type: 'bandpass', freq: 780, q: 2 }, adsr: { a: 0.03, d: 1.1, s: 0.15, r: 0.2 }, gain: 0.04 },                                        // metallic gear chatter
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 1100, q: 0.7 }, adsr: { a: 0.3, d: 1.3, s: 0.3, r: 0.3 }, gain: 0.035 },                                                                                                     // compressor airflow
    { waveform: 'sawtooth', freq: 40, pitchBend: { to: 58, time: 0.9 }, delay: 1.15, filter: { type: 'lowpass', freq: 300, q: 1 }, tremolo: { rate: 26, depth: 0.4 }, adsr: { a: 0.25, d: 0, s: 0.85, r: 0.4 }, gain: 0.085 } ] },                   // low rumble → idle (settles in ~60% through)
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
  // Layered touchdown (per the landing brief): tyre chirp → spin-up squeal → main-gear impact
  // → suspension compression → a brief airframe resonance. Firm but controlled.
  touchdown: { config: { duration: 0.9, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2200, q: 2.5 }, adsr: { a: 0.004, d: 0.09, s: 0, r: 0.04 }, gain: 0.06 },                                             // tyre chirp / scuff
    { waveform: 'sawtooth', freq: 1400, pitchBend: { to: 520, time: 0.09 }, filter: { type: 'highpass', freq: 900, q: 1 }, adsr: { a: 0.004, d: 0.1, s: 0, r: 0.05 }, gain: 0.045 },          // spin-up squeal (drops fast)
    { waveform: 'sine', freq: 120, fm: { rate: 150, depth: 80 }, pitchBend: { to: 70, time: 0.12 }, delay: 0.03, adsr: { a: 0.002, d: 0.2, s: 0, r: 0.1 }, gain: 0.09 },                      // main-gear impact (FM thump)
    { waveform: 'sine', freq: 80, pitchBend: { to: 52, time: 0.35 }, delay: 0.06, filter: { type: 'lowpass', freq: 180, q: 1.4 }, adsr: { a: 0.01, d: 0.4, s: 0, r: 0.2 }, gain: 0.08 },      // suspension compression (settle)
    { waveform: 'triangle', freq: 430, delay: 0.05, filter: { type: 'bandpass', freq: 430, q: 9 }, adsr: { a: 0.003, d: 0.26, s: 0, r: 0.12 }, gain: 0.03 } ] } },                            // damped airframe resonance
  touchdownHard: { config: { duration: 1.0, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1900, q: 2.2 }, adsr: { a: 0.003, d: 0.14, s: 0, r: 0.06 }, gain: 0.08 },                                             // harder tyre chirp/skid
    { waveform: 'sawtooth', freq: 1250, pitchBend: { to: 440, time: 0.12 }, filter: { type: 'bandpass', freq: 1400, q: 5 }, adsr: { a: 0.003, d: 0.14, s: 0, r: 0.06 }, gain: 0.06 },         // longer squeal
    { waveform: 'sine', freq: 110, fm: { rate: 140, depth: 120 }, pitchBend: { to: 56, time: 0.14 }, delay: 0.02, adsr: { a: 0.002, d: 0.26, s: 0, r: 0.12 }, gain: 0.13 },                   // heavy impact
    { waveform: 'sine', freq: 66, pitchBend: { to: 42, time: 0.4 }, tremolo: { rate: 6, depth: 0.5 }, delay: 0.05, filter: { type: 'lowpass', freq: 150, q: 1.5 }, adsr: { a: 0.01, d: 0.5, s: 0, r: 0.25 }, gain: 0.11 },   // deep suspension (1–2 damped bounces)
    { waveform: 'triangle', freq: 360, delay: 0.04, filter: { type: 'bandpass', freq: 360, q: 8 }, adsr: { a: 0.003, d: 0.3, s: 0, r: 0.14 }, gain: 0.045 } ] } },                            // gear/airframe resonance
};
export function groundFx(kind) { const ae = AE(); const d = GROUND_FX[kind] || GROUND_FX.touchdown; try { ae?.init?.(); ae?.playSfx?.(d); } catch {} }

const FLAP_FX = { config: { duration: 0.5, layers: [
  { waveform: 'sawtooth', freq: 210, tremolo: { rate: 34, depth: 0.55 }, filter: { type: 'bandpass', freq: 880, q: 2 }, adsr: { a: 0.03, d: 0.42, s: 0.5, r: 0.1 }, gain: 0.05 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1200, q: 1.5 }, adsr: { a: 0.03, d: 0.42, s: 0.4, r: 0.1 }, gain: 0.022 } ] } };
export function flapWhir() { const ae = AE(); try { ae?.playSfx?.(FLAP_FX); } catch {} }

// Landing gear (per the FM brief): electrically driven, hydraulic-assisted, heavy, precise.
//  extend  = "Nyeeeee-rrrrr-chunk…CHUNK…thud": a descending FM motor whine that dims under
//            load, hydraulic hiss + airframe rumble underneath, ending in metallic locking
//            clunks, a deep thunk, and a tiny ring.
//  retract = "CLUNK-nyEEEER-krrr-THUNK…click-clack": an unlock clunk, then a brighter/rising
//            higher-index FM whine with gear-train chatter + door rattle, a stow thunk, and
//            high uplock clicks. (Inharmonic fm.rate ratios give the metallic/rough texture.)
const GEAR_FX = {
  extend: { config: { duration: 2.0, layers: [
    { waveform: 'sine', freq: 900, pitchBend: { to: 340, time: 1.35 }, fm: { rate: 1180, depth: 220 }, tremolo: { rate: 5, depth: 0.28 }, filter: { type: 'bandpass', freq: 1100, q: 1.6 }, adsr: { a: 0.06, d: 1.3, s: 0.5, r: 0.05 }, gain: 0.08 },   // motor whine, descending + dimming
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1600, q: 0.7 }, adsr: { a: 0.5, d: 0.9, s: 0.4, r: 0.2 }, gain: 0.04 },                                                                                                     // hydraulic hiss swelling under
    { waveform: 'sine', freq: 80, tremolo: { rate: 5, depth: 0.3 }, filter: { type: 'lowpass', freq: 160, q: 1 }, adsr: { a: 0.3, d: 1.2, s: 0.5, r: 0.2 }, gain: 0.05 },                                                                           // airframe rumble
    { waveform: 'square', freq: 150, fm: { rate: 317, depth: 180 }, pitchBend: { to: 110, time: 0.12 }, delay: 1.35, filter: { type: 'bandpass', freq: 900, q: 1.5 }, adsr: { a: 0.002, d: 0.16, s: 0, r: 0.06 }, gain: 0.09 },                     // lock clunk 1
    { waveform: 'square', freq: 130, fm: { rate: 289, depth: 200 }, pitchBend: { to: 92, time: 0.12 }, delay: 1.62, filter: { type: 'bandpass', freq: 760, q: 1.6 }, adsr: { a: 0.002, d: 0.2, s: 0, r: 0.08 }, gain: 0.11 },                       // lock clunk 2 (harder)
    { waveform: 'sine', freq: 70, pitchBend: { to: 40, time: 0.2 }, delay: 1.66, adsr: { a: 0.002, d: 0.28, s: 0, r: 0.1 }, gain: 0.1 },                                                                                                            // deep thunk
    { waveform: 'triangle', freq: 1300, delay: 1.7, filter: { type: 'bandpass', freq: 1300, q: 8 }, adsr: { a: 0.002, d: 0.22, s: 0, r: 0.12 }, gain: 0.03 } ] } },                                                                                 // tiny metallic ring
  retract: { config: { duration: 1.8, layers: [
    { waveform: 'square', freq: 150, fm: { rate: 331, depth: 200 }, pitchBend: { to: 100, time: 0.12 }, filter: { type: 'bandpass', freq: 850, q: 1.5 }, adsr: { a: 0.002, d: 0.2, s: 0, r: 0.08 }, gain: 0.1 },                                    // unlock clunk
    { waveform: 'sine', freq: 70, delay: 0.02, tremolo: { rate: 22, depth: 0.7 }, adsr: { a: 0.005, d: 0.25, s: 0, r: 0.1 }, gain: 0.05 },                                                                                                          // release vibration
    { waveform: 'sine', freq: 520, pitchBend: { to: 680, time: 1.1 }, fm: { rate: 1120, depth: 340 }, tremolo: { rate: 8, depth: 0.35 }, filter: { type: 'bandpass', freq: 1500, q: 1.4 }, delay: 0.16, adsr: { a: 0.05, d: 1.0, s: 0.55, r: 0.04 }, gain: 0.075 },   // bright rising motor whine + chatter
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2000, q: 1.2 }, tremolo: { rate: 11, depth: 0.8 }, delay: 0.3, adsr: { a: 0.1, d: 0.9, s: 0.3, r: 0.15 }, gain: 0.03 },                                                     // door scrape/rattle
    { waveform: 'sine', freq: 90, pitchBend: { to: 48, time: 0.22 }, delay: 1.28, adsr: { a: 0.002, d: 0.3, s: 0, r: 0.1 }, gain: 0.11 },                                                                                                           // stow hydraulic thunk
    { waveform: 'square', freq: 900, fm: { rate: 1970, depth: 260 }, delay: 1.42, filter: { type: 'bandpass', freq: 1800, q: 2.5 }, adsr: { a: 0.001, d: 0.08, s: 0, r: 0.04 }, gain: 0.05 },                                                       // uplock click
    { waveform: 'square', freq: 760, fm: { rate: 1690, depth: 240 }, delay: 1.55, filter: { type: 'bandpass', freq: 1600, q: 2.5 }, adsr: { a: 0.001, d: 0.09, s: 0, r: 0.04 }, gain: 0.05 } ] } },                                                 // uplock clack
};
export function gearFx(kind) { const ae = AE(); const d = GEAR_FX[kind] || GEAR_FX.extend; try { ae?.init?.(); ae?.playSfx?.(d); } catch {} }

// A single heavy .50-cal round — ONE percussive "thud", fired per round by the trigger loop
// (GUN_FIRE_MS cadence) so the sound times up exactly with each muzzle flash + tracer instead
// of a smooth GAU-8 buzz-saw: a deep muzzle THUMP that drops in pitch (recoil), a short low
// body, a sharp round-crack on top, and a doppler tracer "zip" — the round streaking away
// downrange, its pitch falling as it recedes (the same doppler bend the AA tracer whizz-by
// uses, just receding-only since your own rounds fly away from you). At the ~6.7 rnd/s
// cadence the zips overlap into a continuous "zeeew-zeeew" of tracers leaving the muzzles.
const GUN_FX = { config: { duration: 0.3, layers: [
  { waveform: 'sine', freq: 42, pitchBend: { to: 26, time: 0.12 }, filter: { type: 'lowpass', freq: 90, q: 1 }, adsr: { a: 0.001, d: 0.22, s: 0, r: 0.07 }, gain: 0.5 },   // sub-bass CHEST THUMP — the concussive weight of the round
  { waveform: 'sine', freq: 72, pitchBend: { to: 38, time: 0.1 }, filter: { type: 'lowpass', freq: 170, q: 1.1 }, adsr: { a: 0.001, d: 0.18, s: 0, r: 0.06 }, gain: 0.58 }, // deep muzzle THUD + recoil drop — the body of the "thump"
  { waveform: 'sawtooth', freq: 92, pitchBend: { to: 64, time: 0.09 }, filter: { type: 'lowpass', freq: 520, q: 1.3 }, adsr: { a: 0.001, d: 0.13, s: 0, r: 0.05 }, gain: 0.3 }, // low body / breech slam
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 540, q: 0.8 }, adsr: { a: 0.0005, d: 0.075, s: 0, r: 0.03 }, gain: 0.34 },                            // the round-crack (hard percussive attack)
  { waveform: 'sawtooth', freq: 1050, pitchBend: { to: 470, time: 0.14 }, filter: { type: 'bandpass', freq: 1050, q: 1.6 }, adsr: { a: 0.004, d: 0.1, s: 0, r: 0.06 }, gain: 0.03 },  // DOPPLER tracer zip, receding downrange (darkened + non-sustaining to kill the continuous whine)
  { waveform: 'noise', noiseMix: 1, delay: 0.05, filter: { type: 'bandpass', freq: 1000, q: 1.4 }, adsr: { a: 0.003, d: 0.1, s: 0, r: 0.05 }, gain: 0.035 },               // air-rush trailing the round as it goes
  { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 2600, q: 0.7 }, adsr: { a: 0.0005, d: 0.03, s: 0, r: 0.02 }, gain: 0.035 } ] } };                     // high muzzle snap (halved)
// The report heard from OUTSIDE the airframe (external/chase view): less of the in-cockpit
// chest-bass boom, a sharper crack and more high snap (open air, off to the side of the
// muzzles) and a brighter/wider doppler zip (you hear the tracers whip past out here) — the
// same shot, just not sitting behind the breech.
const GUN_FX_EXT = { config: { duration: 0.3, layers: [
  { waveform: 'sine', freq: 40, pitchBend: { to: 26, time: 0.1 }, filter: { type: 'lowpass', freq: 85, q: 1 }, adsr: { a: 0.001, d: 0.18, s: 0, r: 0.05 }, gain: 0.28 },
  { waveform: 'sine', freq: 66, pitchBend: { to: 40, time: 0.1 }, filter: { type: 'lowpass', freq: 175, q: 1.1 }, adsr: { a: 0.001, d: 0.15, s: 0, r: 0.05 }, gain: 0.44 },
  { waveform: 'sawtooth', freq: 88, pitchBend: { to: 62, time: 0.08 }, filter: { type: 'lowpass', freq: 560, q: 1.3 }, adsr: { a: 0.001, d: 0.11, s: 0, r: 0.04 }, gain: 0.28 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 700, q: 0.8 }, adsr: { a: 0.0005, d: 0.075, s: 0, r: 0.03 }, gain: 0.4 },                              // sharper open-air crack
  { waveform: 'sawtooth', freq: 1300, pitchBend: { to: 540, time: 0.15 }, filter: { type: 'bandpass', freq: 1300, q: 1.7 }, adsr: { a: 0.004, d: 0.1, s: 0, r: 0.07 }, gain: 0.04 },  // DOPPLER tracer whip-past (darkened + non-sustaining to kill the continuous whine)
  { waveform: 'noise', noiseMix: 1, delay: 0.06, filter: { type: 'bandpass', freq: 1300, q: 1.3 }, adsr: { a: 0.003, d: 0.11, s: 0, r: 0.06 }, gain: 0.05 },                // air-rush as it recedes
  { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 2800, q: 0.7 }, adsr: { a: 0.0005, d: 0.04, s: 0, r: 0.03 }, gain: 0.06 } ] } };                       // high muzzle snap (halved)
export function gunFx(external) { const ae = AE(); try { ae?.init?.(); ae?.playSfx?.(external ? GUN_FX_EXT : GUN_FX); } catch {} }

// AA / radar-warning-receiver tone — the insistent launch-warning "deedle-deedle": a bright
// square lead chopped by a fast tremolo with a fifth under it, cutting through the engine
// drone. One-shot, fired the moment you enter a ground-fire envelope.
const AA_WARN_FX = { config: { duration: 0.85, layers: [
  { waveform: 'square', freq: 990, tremolo: { rate: 16, depth: 0.9 }, filter: { type: 'bandpass', freq: 1300, q: 3 }, adsr: { a: 0.01, d: 0, s: 1, r: 0.08 }, gain: 0.07 },
  { waveform: 'sawtooth', freq: 660, tremolo: { rate: 16, depth: 0.85 }, filter: { type: 'bandpass', freq: 1000, q: 3 }, adsr: { a: 0.01, d: 0, s: 1, r: 0.08 }, gain: 0.035 } ] } };
export function aaWarn() { const ae = AE(); try { ae?.init?.(); ae?.playSfx?.(AA_WARN_FX); } catch {} }

// Incoming AA tracer — a DOPPLER whizz-by ("neeee-yowww"): the round arrives at a high,
// compressed pitch and drops through a low one the instant it passes and starts receding.
// Proximity-scaled by `near` (0..1, 1 = point-blank): a close pass whizzes faster, wider,
// and brighter than a distant marginal shot. The tonal layers now SUSTAIN through the pitch
// glide (the old def decayed in 0.08s — before the 0.12s bend finished — so the doppler was
// inaudible); a delayed lower noise band fakes the doppler on the air-rush as it goes past.
function tracerFxDef(near) {
  const n = Math.max(0, Math.min(1, near));
  const glide = 0.16 - n * 0.09;        // closer pass = faster drop through the pass point
  const hi = 1300 + n * 2600;           // approaching (doppler-compressed) pitch
  const lo = 240 + n * 180;             // receding pitch once it's behind you
  return { config: { duration: 0.32 + n * 0.16, layers: [
    // Tonal doppler core — rings THROUGH the glide (small sustain) so the sweep is heard.
    { waveform: 'sawtooth', freq: hi, pitchBend: { to: lo, time: glide }, filter: { type: 'bandpass', freq: 1200 + n * 1600, q: 2 }, adsr: { a: 0.005, d: 0.1 + n * 0.06, s: 0.25, r: 0.12 }, gain: 0.05 + n * 0.09 },
    // Bright harmonic an octave up — the sharp edge of the pass; same doppler sweep.
    { waveform: 'triangle', freq: hi * 1.9, pitchBend: { to: lo * 1.9, time: glide }, filter: { type: 'bandpass', freq: 2600, q: 3 }, adsr: { a: 0.004, d: 0.09, s: 0.12, r: 0.08 }, gain: 0.02 + n * 0.05 },
    // Air-rush noise: a bright band on approach...
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1600 + n * 2600, q: 1.6 + n * 1.8 }, adsr: { a: 0.001, d: 0.05 + n * 0.04, s: 0, r: 0.05 }, gain: 0.02 + n * 0.13 },
    // ...then a lower, delayed band as it recedes behind you (doppler on the rush itself).
    { waveform: 'noise', noiseMix: 1, delay: glide * 0.7, filter: { type: 'bandpass', freq: 700 + n * 700, q: 1.2 }, adsr: { a: 0.004, d: 0.1, s: 0, r: 0.08 }, gain: 0.015 + n * 0.08 } ] } };
}
export function tracerFx(near) { const ae = AE(); try { ae?.init?.(); ae?.playSfx?.(tracerFxDef(near)); } catch {} }

// Rounds striking the airframe — an impact crack, a short metallic ring off the skin, and a
// low structural thud. Fires on any confirmed air hit (AA or air-to-air guns) via air_hit.
const HIT_FX = { config: { duration: 0.5, layers: [
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1800, q: 1.4 }, adsr: { a: 0.001, d: 0.1, s: 0, r: 0.12 }, gain: 0.15 },                                                          // impact crack
  { waveform: 'triangle', freq: 1100, pitchBend: { to: 380, time: 0.2 }, filter: { type: 'bandpass', freq: 1400, q: 4 }, adsr: { a: 0.001, d: 0.25, s: 0, r: 0.15 }, gain: 0.06 },                       // metallic ring off the skin
  { waveform: 'sine', freq: 58, adsr: { a: 0.002, d: 0.22, s: 0, r: 0.1 }, gain: 0.13 } ] } };                                                                                                            // low structural thud
export function hitFx() { const ae = AE(); try { ae?.init?.(); ae?.playSfx?.(HIT_FX); } catch {} }

// Seeker lock acquired — a clean rising two-tone chirp settling into a steady lock tone.
// One-shot on the moment the missile seeker goes from search to LOCK.
const LOCK_TONE_FX = { config: { duration: 0.7, layers: [
  { waveform: 'sine', freq: 620, pitchBend: { to: 980, time: 0.18 }, filter: { type: 'bandpass', freq: 900, q: 2.5 }, adsr: { a: 0.01, d: 0.12, s: 0.7, r: 0.1 }, gain: 0.06 },   // rising acquisition chirp
  { waveform: 'square', freq: 980, delay: 0.22, tremolo: { rate: 28, depth: 0.25 }, filter: { type: 'bandpass', freq: 1200, q: 3 }, adsr: { a: 0.01, d: 0, s: 1, r: 0.1 }, gain: 0.045 } ] } };   // steady lock tone
export function lockTone() { const ae = AE(); try { ae?.init?.(); ae?.playSfx?.(LOCK_TONE_FX); } catch {} }

// Incoming-missile RWR warble — nastier and faster than the AA deedle: two square tones
// hard-alternating, impossible to mistake for anything friendly. Fires on the launch warning.
const MSL_WARBLE_FX = { config: { duration: 1.4, layers: [
  { waveform: 'square', freq: 1180, tremolo: { rate: 22, depth: 0.95 }, filter: { type: 'bandpass', freq: 1500, q: 3.5 }, adsr: { a: 0.005, d: 0, s: 1, r: 0.06 }, gain: 0.07 },
  { waveform: 'square', freq: 780, tremolo: { rate: 22, depth: 0.95 }, delay: 0.023, filter: { type: 'bandpass', freq: 1100, q: 3.5 }, adsr: { a: 0.005, d: 0, s: 1, r: 0.06 }, gain: 0.055 } ] } };
export function mslWarble() { const ae = AE(); try { ae?.init?.(); ae?.playSfx?.(MSL_WARBLE_FX); } catch {} }

// Missile launch — the motor ignition thump, then a hard whoosh tearing away and Dopplering
// down as the shot outruns you.
const MISSILE_FX = { config: { duration: 1.3, layers: [
  { waveform: 'sine', freq: 90, pitchBend: { to: 45, time: 0.15 }, adsr: { a: 0.002, d: 0.2, s: 0, r: 0.1 }, gain: 0.12 },                                                          // ignition thump
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2400, q: 0.8 }, pitchBend: { to: 500, time: 1.0 }, adsr: { a: 0.03, d: 0.9, s: 0.2, r: 0.25 }, gain: 0.1 },    // tearing whoosh, falling away
  { waveform: 'sawtooth', freq: 340, pitchBend: { to: 120, time: 0.9 }, filter: { type: 'lowpass', freq: 900, q: 1 }, adsr: { a: 0.02, d: 0.8, s: 0.1, r: 0.2 }, gain: 0.045 } ] } };  // motor roar Dopplering down
export function missileFx() { const ae = AE(); try { ae?.init?.(); ae?.playSfx?.(MISSILE_FX); } catch {} }

// Flares away — a fast string of pyrotechnic thumps kicking out of the dispensers, with a
// bright sizzle riding behind them.
const FLARE_FX = { config: { duration: 0.8, layers: [
  { waveform: 'sine', freq: 120, pitchBend: { to: 60, time: 0.06 }, adsr: { a: 0.002, d: 0.09, s: 0, r: 0.04 }, gain: 0.1 },                                                        // thump 1
  { waveform: 'sine', freq: 120, pitchBend: { to: 60, time: 0.06 }, delay: 0.14, adsr: { a: 0.002, d: 0.09, s: 0, r: 0.04 }, gain: 0.1 },                                            // thump 2
  { waveform: 'sine', freq: 120, pitchBend: { to: 60, time: 0.06 }, delay: 0.28, adsr: { a: 0.002, d: 0.09, s: 0, r: 0.04 }, gain: 0.1 },                                            // thump 3
  { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 3200, q: 0.7 }, delay: 0.06, adsr: { a: 0.05, d: 0.5, s: 0.2, r: 0.2 }, gain: 0.03 } ] } };                     // magnesium sizzle
export function flareFx() { const ae = AE(); try { ae?.init?.(); ae?.playSfx?.(FLARE_FX); } catch {} }

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
