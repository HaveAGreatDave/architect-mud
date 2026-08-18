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
  locust:     { idle: [40, 66],  power: [96, 156],  wave: 'sawtooth', nm: 0.6, wind: 1.0, chug: 6 },   // big crop-duster radial: low, lumpy lope
  heavy:      { idle: [36, 68],  power: [110, 215], wave: 'sawtooth', nm: 0.72, wind: 1.35, whine: 1 },
  gunship:    { idle: [58, 116], power: [165, 300], wave: 'square',   nm: 0.8, wind: 1.35, whine: 1 },
  divebomber: { idle: [34, 62],  power: [86, 148],  wave: 'sawtooth', nm: 0.7, wind: 1.2, whine: 1, chug: 5 },   // one big turbine on a big slow prop: low blade whomp under a turbine edge
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
  locust:     { coreB: 28, coreS: 48, wave: 'sawtooth', pulseB: 16, pulseS: 18, pDep: [0.34, 0.40], biteB: 520,  biteS: 300,  biteM: 1.0, subB: 16, subM: 1.6, lpB: 180, lpS: 820,  crk: 1.5,  det: 1.012, mas: 1.1 },   // crop-duster radial: deep round-motor with a slow lumpy blade "lope" + burbling exhaust
  heavy:      { coreB: 20, coreS: 50, wave: 'sawtooth', pulseB: 30, pulseS: 30, pDep: [0.09, 0.14], biteB: 1050, biteS: 1700, biteM: 2.2, subB: 12, subM: 2.8, lpB: 260, lpS: 1700, crk: 0.4,  det: 1.005, mas: 1.3 },   // An-124: 4 D-18T turbofans — deep roar, huge lows, big turbine whine
  gunship:    { coreB: 30, coreS: 70, wave: 'sawtooth', pulseB: 36, pulseS: 40, pDep: [0.10, 0.15], biteB: 900,  biteS: 1400, biteM: 1.4, subB: 14, subM: 2.0, lpB: 300, lpS: 1500, crk: 0.45, det: 1.006, mas: 1.15 },   // A-10: twin TF34 turbofans — deep hum-growl + big lows, not a fighter scream
  // The Shrike. A single big turbine swinging a huge slow prop, which is a combination almost
  // nothing else in the fleet has: the BLADE is the sound, not the engine. A very low pulse rate
  // with a deep modulation index gives that heavy rhythmic whomp you hear coming a long way off,
  // and a real turbine bite sits on top of it so she does not read as a piston aeroplane. She has
  // to be recognisable by ear alone before the siren ever starts, because on the ground the noise
  // arrives first and knowing what it is IS the mechanic.
  divebomber: { coreB: 26, coreS: 56, wave: 'sawtooth', pulseB: 14, pulseS: 22, pDep: [0.38, 0.44], biteB: 820, biteS: 900, biteM: 1.5, subB: 15, subM: 1.9, lpB: 200, lpS: 1200, crk: 0.8, det: 1.010, mas: 1.15 },
  wreck:      { coreB: 35, coreS: 40, wave: 'sawtooth', pulseB: 18, pulseS: 16, pDep: [0.34, 0.42], biteB: 540,  biteS: 260,  biteM: 0.9, subB: 23, subM: 1.0, lpB: 175, lpS: 680,  crk: 1.4,  det: 1.016, mas: 0.95 },
  // THE LONG HAUL's diesel. The row is the whole port: one line, no new graph, because the twelve
  // layers below were never aircraft-specific — only their numbers were.
  //
  // What makes a diesel sound like a diesel is the PULSE. A slow cylinder firing rate with a deep
  // modulation index is the chug; `pulseB: 9` is roughly a big six loafing and `pDep` near 0.5 is
  // as lumpy as this synth gets. Everything else follows from that: a low core, heavy exhaust
  // crackle, a wide detune for the grit of an engine that has done a lot of miles, and almost NO
  // bite, because a truck has no prop tip and nothing up there whines.
  truck:      { coreB: 17, coreS: 34, wave: 'sawtooth', pulseB: 9,  pulseS: 16, pDep: [0.44, 0.52], biteB: 320,  biteS: 180,  biteM: 0.25, subB: 11, subM: 2.2, lpB: 150, lpS: 620,  crk: 1.8,  det: 1.019, mas: 1.1 },
};

// ── What the road sounds like (THE LONG HAUL) ────────────────────────────────
// The `roll` layer was written for a taxiing aircraft and gated on `onGround`, so for a truck it is
// on for the entire drive and is the second-loudest thing in the cab after the engine.
//
// The point of a per-surface table is that DRIFTING OFF THE ROAD IS AUDIBLE BEFORE IT IS ANYTHING
// ELSE. You hear the shoulder the instant a tyre touches it, half a second before the speed bleeds
// and well before any text says so — which is what makes the corridor's edge a thing you feel
// rather than a rule you are told.
const ROLL_SURFACE = {
  road:     { lvl: 0.30, lp: 210, rattle: 0.10, rr: 46 },   // asphalt: a low even hiss
  shoulder: { lvl: 0.62, lp: 520, rattle: 0.55, rr: 74 },   // gravel: coarse, loud, and it rattles
  offroad:  { lvl: 0.80, lp: 380, rattle: 0.85, rr: 33 },   // the verge: slower, heavier, wrong
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
    const rollLP = filt('lowpass', 210, 0.8), rollLvl = gain(0.3);
    noiseSrc().connect(rollLP).connect(rollLvl).connect(rollGate);
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
      air: { hp: airHP, gain: airGain }, wind: { bp: windBP, gain: windGain },
      roll: { gate: rollGate, lp: rollLP, lvl: rollLvl, rattle: rattleLevel, rattleOsc },
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
  // CABIN: you're walking a room somewhere aft, not sitting at the controls, with a pressure
  // bulkhead and a hold between you and four engines slung out on the wing. What reaches you is
  // almost entirely low end — the highs are the first thing structure eats — so this is a hard
  // lowpass plus a level trim rather than just a volume cut. Quiet-and-full-range sounds like the
  // engines moved away; muffled-and-present sounds like you moved INSIDE something.
  const cabin = s.perspective === 'cabin';
  const windMul = ext ? 1.0 : (cabin ? 0.22 : 0.4);
  const highsMul = ext ? 1.0 : (cabin ? 0.18 : 0.5);
  const lowsMul = ext ? 1.0 : (cabin ? 1.45 : 1.2);   // lows come THROUGH the airframe — lean on them
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
  // GROUND ROLL. An aircraft only has it while taxiing, so this was gated on `onGround`; a truck
  // has it for the whole drive, and WHICH surface it is on is most of the information it carries.
  // Passing `s.surface` opts into the road table; an aircraft passes none and behaves exactly as
  // before. The tau is deliberately short — the shoulder has to arrive AS the tyre touches it,
  // half a second before the speed bleeds and well before any text says so.
  const rs = ROLL_SURFACE[s.surface];
  if (rs) {
    const v = _c01((s.groundSpeed || 0) / 70);
    set(N.roll.gate.gain, _cl(0.06 + v * rs.lvl, 0, 0.9), 0.12);   // fast tau: the shoulder must arrive AS you touch it
    set(N.roll.lp.frequency, rs.lp + v * 240, 0.15);
    set(N.roll.rattle.gain, rs.rattle * (0.25 + v * 0.75) * 0.14, 0.12);
    try { N.roll.rattleOsc.frequency.setTargetAtTime(rs.rr + v * 30, now, 0.15); } catch {}
  } else {
    set(N.roll.gate.gain, s.onGround ? _cl(0.1 + (s.groundSpeed || 0) / 60, 0, 0.4) : 0, 0.20);
  }
  // Tone: exterior is wide open, the cockpit is already damped, the CABIN is muffled hard — 340 Hz
  // keeps the core rumble and the blade pulse (the parts you feel) and throws away the whine.
  set(N.toneFilter.frequency, Math.max(cabin ? 300 : 400, (ext ? 9000 : cabin ? 340 : 2600) * (1 - dist * 0.6)), 0.25);
  // …and back the whole bus off a little, so it sits UNDER the room rather than over it. Still
  // plainly audible: this is a trim, not a mute — a Leviathan is never quiet.
  // Written ONLY when the cabin state actually flips. `master.gain` also carries the start-up swell
  // (a linearRamp scheduled at create time), and a setTargetAtTime on it every frame would override
  // that ramp and make every aircraft in the fleet snap to full volume instead of spooling in.
  if (N._cabinOn !== cabin) {
    N._cabinOn = cabin;
    set(N.master.gain, (N.voice?.mas ?? 0.5) * (cabin ? 0.62 : 1), 0.30);
  }
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
let curWeather = null, _lastThunder = 0;

// Recorded thunder claps — the same samples the ground weather plays on `weather.thunder`
// (thunder4/5/6). Far cleaner than a synthesized noise burst, which read as static hiss.
// snes_bits:0 bypasses AudioEngine's retro bit-crush so the recording stays crisp.
const THUNDER_SAMPLES = [
  'smp_357d0dd8-6e28-44c8-8db9-33ede3ca6e79',   // thunder4
  'smp_457b9e5f-a133-4351-bd19-deedb2e96fd4',   // thunder5
  'smp_94055023-841c-4346-8f75-ba4b85a28eee',   // thunder6
];
export function playThunderSample(gain = 0.6) {
  const ae = AE(); if (!ae?.playSample) return;
  const id = THUNDER_SAMPLES[(Math.random() * THUNDER_SAMPLES.length) | 0];
  try { ae.playSample({ id, snes_bits: 0, category: 'ambient', priority: 4, config: { gain: 1 } }, { gain }); } catch {}
}

// Proximity of the aircraft to the nearest storm cell of the live weather field: 1 inside the
// cell, falling to 0 by ~STORM_FALLOFF tiles beyond its edge. Drives thunder cadence + volume so
// only storms actually near the plane rumble (distant cells stay silent). Returns 0 if we have no
// field / position (the old always-on ambient cadence is retired in favour of this).
const STORM_FALLOFF = 45;
function stormProximity(s) {
  const cells = s?.sky?.field?.cells; const ax = s?.acX, ay = s?.acY;
  if (!cells || !cells.length || ax == null || ay == null) return 0;
  let near = 0;
  for (const c of cells) {
    if (c.type !== 'storm') continue;
    const edge = Math.hypot(c.x - ax, c.y - ay) - (c.r || 0);
    const n = edge <= 0 ? 1 : Math.max(0, 1 - edge / STORM_FALLOFF);
    if (n > near) near = n;
  }
  return near;
}
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
    // Thunder — a recorded clap, but ONLY when a storm cell is near the aircraft (closer ⇒ more
    // frequent + louder). No fixed cadence: distant storms stay silent, and a min-interval keeps
    // claps from clustering. Replaces the old always-on synthesized rumble that sounded like static.
    if (key === 'storm') {
      const near = stormProximity(s);
      const nowMs = Date.now();
      if (near > 0.08 && nowMs - _lastThunder > 2600 && Math.random() < 0.04 + near * 0.15) {
        _lastThunder = nowMs;
        playThunderSample(0.3 + near * 0.6);
      }
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
  const ids = ['flt-eng-idle', 'flt-eng-power', 'flt-wind', 'flt-roll', 'flt-stallhorn', 'flt-weather', ...SIREN_IDS];
  ids.forEach(id => ae.setLoopGain?.(id, 0, fast ? 0.15 : 0.6));
  setTimeout(() => { try { ids.forEach(id => ae.stopLoop(id)); } catch {} }, fast ? 200 : 800);
  running = false; curClass = null; curWeather = null; _hornOn = false; _sirenOn = false;
}

// killLoops also stops the loops that live INDEPENDENTLY of `running` — the stall
// horn (flt-stallhorn) and the weather bed (flt-weather), both started from the
// continuous fixed-wing path where `running` is never set. Gating it on `running`
// leaked those: a stall horn sounding on a fixed-wing flight would drone on forever
// (ambient bus, survives every mute) after close. So call it unconditionally.
export function stopEngineAudio() { killLoops(false); stopFlightEngine(false); }

// Ride the engine sound off the live HUD state. Called every cockpit update (~4/s).
export function updateEngineAudio(s) {
  const ae = AE(); if (!ae) return;
  // Fire killLoops when parked/off if ANY loop it owns is alive — the generic loops
  // (running) OR the independently-started stall horn / weather bed. Broadening past
  // `running` stops a stall horn left ringing after a fixed-wing shutdown on the deck;
  // once its flags clear, subsequent ~4/s ticks skip it, so no churn.
  if (!s || (!s.airborne && !s.engineOn)) { if (running || _hornOn || _sirenOn || curWeather) killLoops(false); stopFlightEngine(false); return; }

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
  // Crop-duster radial (P&W R-985 class): a slow inertia-starter whine winds up, the big
  // cylinders turn over in a lumpy chug, then it catches with a bark and settles into a low,
  // burbling round-motor lope. Slower and heavier to light than the little piston single.
  locust:  { duration: 2.6, layers: [
    { waveform: 'triangle', freq: 120, pitchBend: { to: 300, time: 1.0 }, filter: { type: 'bandpass', freq: 1200, q: 1.2 }, adsr: { a: 0.05, d: 1.0, s: 0.2, r: 0.2 }, gain: 0.05 },                       // inertia-starter whine winding up
    { waveform: 'square', freq: 30, tremolo: { rate: 5.5, depth: 0.9 }, filter: { type: 'lowpass', freq: 300, q: 1 }, adsr: { a: 0.05, d: 1.1, s: 0.2, r: 0.2 }, gain: 0.10 },                              // big cylinders turning over (slow lumpy chug)
    { waveform: 'sawtooth', freq: 34, delay: 1.0, pitchBend: { to: 150, time: 1.4 }, filter: { type: 'lowpass', freq: 620, q: 1 }, adsr: { a: 0.06, d: 1.3, s: 0.5, r: 0.3 }, gain: 0.12 },                 // catch + wind up to a loping idle
    { waveform: 'noise', noiseMix: 1, delay: 1.0, filter: { type: 'bandpass', freq: 240, q: 1 }, tremolo: { rate: 8, depth: 0.5 }, adsr: { a: 0.06, d: 1.2, s: 0.35, r: 0.3 }, gain: 0.07 } ] },            // burbling radial exhaust
  // Shrike: a big turbine lighting a big prop. Cartridge bang first — she is started by an
  // explosive charge, which is the one theatrical detail in an otherwise grim aeroplane — then a
  // long turbine wind-up under a slow, heavy blade chop that accelerates until the individual
  // blades stop being audible as separate events.
  divebomber: { duration: 3.0, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 520, q: 0.7 }, adsr: { a: 0.004, d: 0.30, s: 0, r: 0.12 }, gain: 0.11 },                                                            // the cartridge going off
    { waveform: 'triangle', freq: 48, pitchBend: { to: 560, time: 2.5 }, filter: { type: 'lowpass', freq: 2400, q: 1.4 }, adsr: { a: 0.18, d: 2.5, s: 0.5, r: 0.4 }, gain: 0.10 },                          // turbine winding up
    { waveform: 'square', freq: 26, tremolo: { rate: 4.5, depth: 0.92 }, delay: 0.25, filter: { type: 'lowpass', freq: 320, q: 1 }, adsr: { a: 0.10, d: 1.6, s: 0.3, r: 0.3 }, gain: 0.11 },                // the blade chop, slow and heavy at first
    { waveform: 'sawtooth', freq: 30, delay: 1.1, pitchBend: { to: 138, time: 1.6 }, filter: { type: 'lowpass', freq: 700, q: 1 }, adsr: { a: 0.08, d: 1.5, s: 0.55, r: 0.35 }, gain: 0.12 },               // settling into a loping idle
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 1300, q: 0.7 }, adsr: { a: 0.9, d: 2.0, s: 0.4, r: 0.4 }, gain: 0.04 } ] },                                                         // compressor airflow
  // Salvaged wreck: it doesn't want to start — a couple of dead coughs, then a
  // rough, uneven catch.
  wreck:   { duration: 2.0, layers: [
    { waveform: 'square', freq: 48, pitchBend: { to: 30, time: 0.4 }, adsr: { a: 0.02, d: 0.35, s: 0, r: 0.1 }, gain: 0.08 },                                                        // cough 1
    { waveform: 'square', freq: 54, delay: 0.55, pitchBend: { to: 34, time: 0.4 }, adsr: { a: 0.02, d: 0.35, s: 0, r: 0.1 }, gain: 0.08 },                                           // cough 2
    { waveform: 'sawtooth', freq: 24, delay: 1.0, pitchBend: { to: 118, time: 1.0 }, tremolo: { rate: 6, depth: 0.4 }, filter: { type: 'lowpass', freq: 600, q: 1 }, adsr: { a: 0.06, d: 0.9, s: 0.4, r: 0.3 }, gain: 0.11 },  // rough catch
    { waveform: 'noise', noiseMix: 1, delay: 1.0, filter: { type: 'bandpass', freq: 240, q: 1 }, adsr: { a: 0.05, d: 0.9, s: 0.2, r: 0.2 }, gain: 0.05 } ] },
};
export function spoolUp(cls) { const ae = AE(); const d = SPOOL_UP[cls] || SPOOL_UP.prop; try { ae?.init?.(); ae?.playSfx?.({ config: d }); } catch {} }

// ── LIGHTING THE LIFTERS ──────────────────────────────────────────────────────
// A truck asking for `spoolUp` got the piston single's row, because there was no truck row and
// `prop` is the fallback — so the one moment in THE LONG HAUL where a hover rig stops being
// furniture and becomes a machine was scored with a car's starter motor cranking.
//
// A lifter does not crank. FOUR THINGS HAPPEN, IN THIS ORDER, and the sequence is the sound:
//   1. the CONTACTOR drops in — a hard, dry clunk, the switch closing before anything moves;
//   2. the COILS CHARGE — a resonant whine climbing under mounting FM complexity, which is the
//      part the ear reads as "spinning up" even though nothing here spins;
//   3. the WEIGHT COMES OFF — a swell of filtered noise as the pods bite and shove the air out
//      from under a parked chassis, delayed to land where the model actually leaves the ground;
//   4. it SETTLES — a low sustaining hum under everything, so the cue ends holding rather than
//      stopping, the same trick the `ultralight` start uses to arrive at an idle.
//
// PER TRUCK, because four rigs that light identically are one rig with four price tags. The
// character is the same character the drivetrain already has: the Barrow is a bad-tempered old
// thing that fumbles the catch and lights ROUGH, the Courier is light and quick and over with,
// the Drayman is the honest middle, and the Continental is enormous — it takes the longest, sits
// the lowest, and moves the most air, which is the whole of what tier 3 buys you at this moment.
const HOVER_SPOOL = {
  // Krell Barrow — a dead contactor click, a coil that sags before it takes, and grit all through
  // it. The only rig here whose start-up has a stumble in it, and it is the cheapest for a reason.
  scrapper: { duration: 2.4, layers: [
    { waveform: 'square', freq: 92, pitchBend: { to: 38, time: 0.09 }, filter: { type: 'lowpass', freq: 900, q: 1.2 }, adsr: { a: 0.004, d: 0.11, s: 0, r: 0.05 }, gain: 0.10 },   // contactor, and it does not sound healthy
    { waveform: 'square', freq: 86, delay: 0.34, pitchBend: { to: 44, time: 0.08 }, filter: { type: 'lowpass', freq: 800, q: 1.2 }, adsr: { a: 0.004, d: 0.1, s: 0, r: 0.05 }, gain: 0.07 },   // it did not take: a second try
    { waveform: 'triangle', freq: 120, delay: 0.42, pitchBend: { to: 430, time: 1.5 }, fm: { rate: 190, depth: 130 }, vibrato: { rate: 6.5, depth: 14 }, filter: { type: 'bandpass', freq: 1150, q: 1.6 }, adsr: { a: 0.1, d: 1.5, s: 0.34, r: 0.35 }, gain: 0.055 },   // coils, sagging as they climb
    { waveform: 'noise', noiseMix: 1, delay: 1.05, filter: { type: 'bandpass', freq: 430, q: 0.8 }, tremolo: { rate: 13, depth: 0.5 }, adsr: { a: 0.28, d: 1.0, s: 0.22, r: 0.3 }, gain: 0.075 },   // the weight coming off, gritty
    { waveform: 'sawtooth', freq: 30, delay: 1.35, pitchBend: { to: 27, time: 0.7 }, filter: { type: 'lowpass', freq: 230, q: 1 }, tremolo: { rate: 7, depth: 0.42 }, adsr: { a: 0.3, d: 0, s: 0.8, r: 0.4 }, gain: 0.085 } ] },   // a lumpy hold
  // Ostrek Courier — light, bright and quick. It is up before you have finished pressing the thing.
  hauler: { duration: 2.0, layers: [
    { waveform: 'square', freq: 128, pitchBend: { to: 52, time: 0.07 }, filter: { type: 'lowpass', freq: 1400, q: 1.1 }, adsr: { a: 0.003, d: 0.08, s: 0, r: 0.04 }, gain: 0.10 },
    { waveform: 'sine', freq: 210, delay: 0.06, pitchBend: { to: 780, time: 1.1 }, fm: { rate: 340, depth: 150 }, filter: { type: 'bandpass', freq: 1900, q: 1.5 }, adsr: { a: 0.05, d: 1.2, s: 0.36, r: 0.3 }, gain: 0.06 },
    { waveform: 'noise', noiseMix: 1, delay: 0.62, filter: { type: 'bandpass', freq: 620, q: 0.9 }, adsr: { a: 0.18, d: 0.8, s: 0.2, r: 0.28 }, gain: 0.065 },
    { waveform: 'sawtooth', freq: 40, delay: 0.95, pitchBend: { to: 36, time: 0.6 }, filter: { type: 'lowpass', freq: 300, q: 1 }, tremolo: { rate: 11, depth: 0.28 }, adsr: { a: 0.24, d: 0, s: 0.8, r: 0.35 }, gain: 0.08 } ] },
  // Vachon Drayman — the one everybody learns on, and it lights like it: clean, unhurried, no drama.
  drayman: { duration: 2.5, layers: [
    { waveform: 'square', freq: 108, pitchBend: { to: 44, time: 0.08 }, filter: { type: 'lowpass', freq: 1100, q: 1.2 }, adsr: { a: 0.003, d: 0.1, s: 0, r: 0.05 }, gain: 0.11 },
    { waveform: 'sine', freq: 165, delay: 0.07, pitchBend: { to: 600, time: 1.5 }, fm: { rate: 265, depth: 140 }, vibrato: { rate: 5, depth: 7 }, filter: { type: 'bandpass', freq: 1550, q: 1.4 }, adsr: { a: 0.07, d: 1.6, s: 0.4, r: 0.35 }, gain: 0.062 },
    { waveform: 'noise', noiseMix: 1, delay: 0.85, filter: { type: 'bandpass', freq: 500, q: 0.85 }, adsr: { a: 0.26, d: 1.0, s: 0.24, r: 0.32 }, gain: 0.08 },
    { waveform: 'sawtooth', freq: 33, delay: 1.25, pitchBend: { to: 30, time: 0.7 }, filter: { type: 'lowpass', freq: 250, q: 1 }, tremolo: { rate: 8.5, depth: 0.3 }, adsr: { a: 0.3, d: 0, s: 0.85, r: 0.4 }, gain: 0.09 } ] },
  // Orlov Continental — a building standing up. The slowest to light, the deepest hold, and by far
  // the most air moved: the noise layer is nearly as loud as the hum, because six metres of chassis
  // coming off the concrete is mostly a sound you feel through the floor.
  continental: { duration: 3.4, layers: [
    { waveform: 'square', freq: 84, pitchBend: { to: 32, time: 0.12 }, filter: { type: 'lowpass', freq: 700, q: 1.3 }, adsr: { a: 0.004, d: 0.16, s: 0, r: 0.07 }, gain: 0.12 },
    { waveform: 'triangle', freq: 96, delay: 0.1, pitchBend: { to: 470, time: 2.4 }, fm: { rate: 205, depth: 180 }, vibrato: { rate: 3.6, depth: 6 }, filter: { type: 'bandpass', freq: 1250, q: 1.5 }, adsr: { a: 0.14, d: 2.5, s: 0.45, r: 0.45 }, gain: 0.07 },
    { waveform: 'noise', noiseMix: 1, delay: 1.3, filter: { type: 'bandpass', freq: 340, q: 0.7 }, tremolo: { rate: 6, depth: 0.35 }, adsr: { a: 0.45, d: 1.5, s: 0.3, r: 0.45 }, gain: 0.105 },
    { waveform: 'sawtooth', freq: 24, delay: 1.7, pitchBend: { to: 21, time: 1.0 }, filter: { type: 'lowpass', freq: 190, q: 1 }, tremolo: { rate: 6, depth: 0.34 }, adsr: { a: 0.4, d: 0, s: 0.9, r: 0.5 }, gain: 0.105 } ] },
};
// How long each rig takes to get its weight off the floor — the visual sequence reads this so the
// dust and the rise land ON the sound rather than near it, and one table stays the source of both.
export const hoverSpoolSeconds = (typeId) => (HOVER_SPOOL[typeId] || HOVER_SPOOL.drayman).duration;

// ── THE AIR HORN ──────────────────────────────────────────────────────────────
// Two chrome trumpets got bolted to the roof of every rig, and a horn you cannot sound is an
// ornament. This is the sound half of making it real (`horn` in plugins/trucking is the verb).
//
// AN AIR HORN IS A CHORD, NOT A NOTE. That is the whole thing, and it is why one oscillator would
// have sounded like a doorbell however carefully it was tuned: two trumpets of different lengths
// are sounded off one tank, and what you hear is the BEAT between them. The intervals here are the
// real ones — a minor third for the big rigs (the mournful two-tone you hear across a valley) and
// a wider, brighter fourth for the little Courier, which has less pipe to work with.
//
// Each voice is a sawtooth (a trumpet is all odd harmonics and then some) through a bandpass that
// opens as the diaphragm gets going, with a fast attack and a tail that falls away rather than
// stopping — a horn runs on stored air, so the end of the note is the tank giving up, not a switch.
// ⚠ WHY THIS IS LOUDER THAN IT LOOKS IT SHOULD BE, AND WHY IT WAS INAUDIBLE.
// A nominal `gain` is not a loudness — it is a loudness BEFORE the filter, and this was the only
// cue in the file whose voices run through a BANDPASS rather than a lowpass. A bandpass is 0 dB at
// its centre and attenuates everything else, and the centre was 3.2× the fundamental: for the
// Drayman that is 560 Hz against a 175 Hz sawtooth, so the loudest thing in the waveform — the
// fundamental, and most of its energy — was sitting most of two octaves down the skirt and being
// thrown away. What reached the bus was the 3rd and 4th harmonics of a horn at a third of the gain
// it claimed. The cue was never dropped, never mis-shaped and never starved of a voice; it was
// filtered into nothing, which is why it read as "seems inaudible" rather than as silence.
//
// The centre now sits just above the fundamental, which is also where a real air horn's energy
// actually peaks, so the trumpet character survives and the note arrives at the level the number
// says. Gains roughly doubled on top of that — a horn is the loudest thing in a yard and this is
// the one cue in the game where that is the whole point of it existing.
export const HORN = {
  scrapper:    { base: 196, ratio: 1.19, dur: 1.05, gain: 0.34, air: 1.5 },   // one working trumpet and a lot of rust
  hauler:      { base: 262, ratio: 1.34, dur: 0.95, gain: 0.33, air: 0.9 },   // short pipes: brighter, wider, over quickly
  drayman:     { base: 175, ratio: 1.20, dur: 1.35, gain: 0.37, air: 1.0 },
  continental: { base: 124, ratio: 1.19, dur: 1.9,  gain: 0.40, air: 1.2 },   // the one you hear before you see it
};
// ⚠ AND IT IS LOUD, BECAUSE LOUD IS THE ONLY SETTING A HORN HAS. These gains were doubled once
// already, off the bandpass fix above, and it STILL sat under the engine bed — a driver leaning on
// the cord could barely hear it over their own idle, which is exactly the wrong way round for the
// loudest object bolted to a truck. Doubled again (0.15 → 0.34): deliberately the loudest cue in
// the game, because being the loudest thing in the yard is the entire function of the device.
//
// ⚠ AND EVERY TRUCK HAS ITS OWN. `HORN[typeId] || HORN.drayman` hides a missing row — a new truck
// would silently borrow the Drayman's trumpets and nobody would ever find out. The fallback stays
// (a borrowed horn beats a silent one), and regress now asserts every ground type in TYPES has a
// row here, so adding a truck without a voice is a red suite rather than a mystery.
// `secs` is how long the driver held the cord, so the yard hears a toot or a long lean on it rather
// than the same stock blast either way. Absent (an older sender, or any non-cab caller) is the
// horn's own authored length exactly as before.
export function airHorn(typeId, secs = null) {
  const ae = AE(); const h0 = HORN[typeId] || HORN.drayman;
  const h = secs ? { ...h0, dur: Math.max(0.18, Math.min(4, secs)) } : h0;
  // ⚠ The voices are `hornVoices`, shared with the held horn below — see the note there. (The
  // centre of the bandpass sits just ABOVE the fundamental, not three octaves up it, with a wider Q
  // so the skirt keeps the upper harmonics that make it a trumpet rather than a hum.)
  const d = { duration: h.dur + 0.35, layers: hornVoices(h, false) };
  try { ae?.init?.(); ae?.playSfx?.({ config: d }); } catch {}
}
// ── THE HORN IS HELD, NOT PRESSED ────────────────────────────────────────────
// A cord you pull is open for as long as you pull it, and the fixed-length blast this used to be
// was the single most button-like thing in a cab full of controls that are not buttons. So there
// are two ways in now and they share every number: the ONE-SHOT above, which is what the room
// hears (and now takes the length the driver actually held it), and this SUSTAINED pair.
//
// ⚠ IT IS A LOOP ON THE SFX BUS, not on the ambience bed — see loopSound. And it is deliberately
// built from `hornVoices` rather than a second set of oscillators: the horn you hold and the horn
// the yard hears must be the same instrument, or holding the cord changes the truck.
const HORN_LOOP_ID = 'truck-horn-held';
function hornVoices(h, sustain) {
  const voice = (freq, gain) => ([
    { waveform: 'sawtooth', freq, pitchBend: { to: freq * 1.006, time: 0.08 },
      filter: { type: 'bandpass', freq: freq * 1.8, q: 0.9 },
      adsr: sustain ? { a: 0.035, d: 0.12, s: 0.92, r: 0.18 } : { a: 0.035, d: h.dur * 0.35, s: 0.72, r: h.dur * 0.45 }, gain },
    { waveform: 'square', freq: freq * 2, delay: 0.02,
      filter: { type: 'lowpass', freq: freq * 5, q: 0.8 },
      adsr: sustain ? { a: 0.05, d: 0.15, s: 0.5, r: 0.2 } : { a: 0.05, d: h.dur * 0.4, s: 0.4, r: h.dur * 0.4 }, gain: gain * 0.4 },
  ]);
  return [
    ...voice(h.base, h.gain),
    ...voice(h.base * h.ratio, h.gain * 0.86),
    // Air leaking past the diaphragms for as long as the valve is open. Cheap, and it is the
    // difference between a chord and a horn.
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 2600, q: 0.7 },
      adsr: sustain ? { a: 0.02, d: 0.2, s: 0.3, r: 0.25 } : { a: 0.02, d: 0.3, s: 0.22, r: 0.3 }, gain: 0.02 * h.air },
  ];
}
export function airHornOn(typeId) {
  const ae = AE(); const h = HORN[typeId] || HORN.drayman;
  try {
    ae?.init?.();
    ae?.stopLoop?.(HORN_LOOP_ID);      // a second pull while one is open is one horn, not two
    // ⚠ PRIORITY 4, NOT 2. A cab already has a bed, a damage loop, weather and whatever the street
    // is doing, and at 2 the one cue that MUST be heard was competing with ambience for a voice —
    // and losing, silently, which is indistinguishable from a horn that does not work at all.
    ae?.loopSound?.({ id: HORN_LOOP_ID, category: 'sfx', priority: 4, config: { layers: hornVoices(h, true) } });
  } catch { /* never load-bearing */ }
}
export function airHornOff() {
  try { AE()?.stopLoop?.(HORN_LOOP_ID); } catch { /* never load-bearing */ }
}
export function hoverSpool(typeId) {
  const ae = AE(); const d = HOVER_SPOOL[typeId] || HOVER_SPOOL.drayman;
  try { ae?.init?.(); ae?.playSfx?.({ config: d }); } catch {}
}
export function spoolDown(cls) {
  const p = prof(cls); const ae = AE();
  const d = { duration: 1.2, layers: [
    { waveform: p.wave, freq: p.idle[1], pitchBend: { to: 22, time: 1.1 }, filter: { type: 'lowpass', freq: 500, q: 1 }, adsr: { a: 0.02, d: 1.0, s: 0.2, r: 0.2 }, gain: 0.11 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 300, q: 0.7 }, adsr: { a: 0.02, d: 1.0, s: 0.1, r: 0.2 }, gain: 0.05 } ] };
  // ⚠ `{ config: d }`, not `d`. playSfx takes a DEF and reads `def.config` — a bare
  // {duration, layers} fails its `!def?.config` guard and returns having played nothing,
  // silently and forever. Every def in this file that is written out as a constant carries
  // its own `config` wrapper (CREAKS, SPRAY_FX, GEAR_FX…), so only the ones BUILT AT THE
  // CALL SITE can get this wrong — spoolUp, hoverSpool and airHorn all wrap; this one did not.
  try { ae?.playSfx?.({ config: d }); } catch {}
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

// Crop-duster SPRAY release — the hopper bay doors / boom valves clack open with a solid
// thunk, then the pressurised chemical dumps as a swelling atomised hiss with a fine spatter.
const SPRAY_FX = { config: { duration: 1.4, layers: [
  { waveform: 'square', freq: 150, pitchBend: { to: 90, time: 0.08 }, filter: { type: 'bandpass', freq: 420, q: 3 }, adsr: { a: 0.002, d: 0.12, s: 0, r: 0.05 }, gain: 0.10 },                     // boom valves clack open
  { waveform: 'sine', freq: 70, delay: 0.02, adsr: { a: 0.002, d: 0.18, s: 0, r: 0.08 }, gain: 0.07 },                                                                                            // door thunk
  { waveform: 'noise', noiseMix: 1, delay: 0.06, filter: { type: 'bandpass', freq: 2600, q: 0.6 }, adsr: { a: 0.06, d: 0.5, s: 0.5, r: 0.5 }, gain: 0.09 },                                        // pressurised atomised hiss (swells)
  { waveform: 'noise', noiseMix: 1, delay: 0.06, filter: { type: 'highpass', freq: 5200, q: 0.5 }, tremolo: { rate: 22, depth: 0.4 }, adsr: { a: 0.1, d: 0.5, s: 0.4, r: 0.5 }, gain: 0.05 } ] } };  // fine spatter
export function spraySfx() { const ae = AE(); try { ae?.playSfx?.(SPRAY_FX); } catch { /* no audio */ } }

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

// Cargo visor nose (Leviathan) — a HUGE, slow hydraulic hinge, an order heavier and longer than
// the gear: a deep electric screw-jack motor grind, a broad structural groan of the nose swinging
// on its bearing, hydraulic hiss, and a terminal locking sequence.
//  open  = an unlatch THUNK, then a low descending-load motor grind + groan as the nose yawns up.
//  close = a rising motor grind that dims under load as the mass comes down, hydraulic hiss, then
//          a deep seating THUNK and the up/down-locks driving home (clunk-clack).
const VISOR_FX = {
  open: { config: { duration: 4.6, layers: [
    { waveform: 'square', freq: 120, fm: { rate: 268, depth: 170 }, pitchBend: { to: 84, time: 0.12 }, filter: { type: 'bandpass', freq: 700, q: 1.5 }, adsr: { a: 0.002, d: 0.22, s: 0, r: 0.1 }, gain: 0.11 },                                        // unlatch clunk
    { waveform: 'sawtooth', freq: 220, pitchBend: { to: 150, time: 3.6 }, fm: { rate: 96, depth: 40 }, tremolo: { rate: 17, depth: 0.4 }, filter: { type: 'lowpass', freq: 520, q: 2 }, adsr: { a: 0.35, d: 3.6, s: 0.55, r: 0.35 }, delay: 0.24, gain: 0.075 },   // heavy screw-jack motor grind, descending under load
    { waveform: 'sine', freq: 58, tremolo: { rate: 3.4, depth: 0.35 }, filter: { type: 'lowpass', freq: 130, q: 1 }, adsr: { a: 0.6, d: 3.4, s: 0.55, r: 0.5 }, delay: 0.24, gain: 0.06 },                                                                    // structural groan of the nose on its bearing
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1300, q: 0.6 }, adsr: { a: 0.7, d: 2.6, s: 0.4, r: 0.6 }, delay: 0.3, gain: 0.03 },                                                                                                   // hydraulic hiss swelling under
    { waveform: 'triangle', freq: 900, delay: 4.35, filter: { type: 'bandpass', freq: 900, q: 8 }, adsr: { a: 0.002, d: 0.26, s: 0, r: 0.14 }, gain: 0.03 } ] } },                                                                                            // up-lock ring as it reaches the raised stop
  close: { config: { duration: 4.8, layers: [
    { waveform: 'sawtooth', freq: 150, pitchBend: { to: 240, time: 3.4 }, fm: { rate: 110, depth: 46 }, tremolo: { rate: 15, depth: 0.42 }, filter: { type: 'lowpass', freq: 560, q: 2 }, adsr: { a: 0.3, d: 3.3, s: 0.6, r: 0.3 }, gain: 0.08 },              // motor grind rising then dimming as the mass comes down
    { waveform: 'sine', freq: 66, pitchBend: { to: 50, time: 3.4 }, tremolo: { rate: 3, depth: 0.35 }, filter: { type: 'lowpass', freq: 140, q: 1 }, adsr: { a: 0.5, d: 3.4, s: 0.5, r: 0.4 }, gain: 0.06 },                                                   // descending structural groan
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1500, q: 0.7 }, tremolo: { rate: 9, depth: 0.5 }, adsr: { a: 0.4, d: 3.2, s: 0.35, r: 0.5 }, gain: 0.03 },                                                                            // hydraulic hiss
    { waveform: 'sine', freq: 74, pitchBend: { to: 40, time: 0.22 }, delay: 3.95, adsr: { a: 0.002, d: 0.34, s: 0, r: 0.14 }, gain: 0.13 },                                                                                                                   // deep seating thunk as it beds home
    { waveform: 'square', freq: 150, fm: { rate: 317, depth: 190 }, pitchBend: { to: 100, time: 0.12 }, delay: 4.16, filter: { type: 'bandpass', freq: 820, q: 1.6 }, adsr: { a: 0.002, d: 0.18, s: 0, r: 0.07 }, gain: 0.1 },                                // down-lock clunk
    { waveform: 'square', freq: 128, fm: { rate: 283, depth: 200 }, pitchBend: { to: 88, time: 0.12 }, delay: 4.36, filter: { type: 'bandpass', freq: 720, q: 1.7 }, adsr: { a: 0.002, d: 0.2, s: 0, r: 0.08 }, gain: 0.11 } ] } },                           // down-lock clack (harder)
};
export function visorFx(kind) { const ae = AE(); const d = VISOR_FX[kind] || VISOR_FX.close; try { ae?.init?.(); ae?.playSfx?.(d); } catch {} }

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
// The LIGHT chin gun (the Viper's turret) — a peashooter beside the cannon above, and it's meant
// to sound like one. Same shot anatomy so the two read as the same family of weapon, but the
// chest-bass is gone, the body sits an octave up, and everything is shorter and drier: a fast,
// tinny RAT-TAT-TAT rather than a heavy thud. Fired at GUN_FIRE_MS_LIGHT (~2× the cadence), so
// keeping each round brief is what stops the burst turning to mush.
const GUN_LIGHT_FX = { config: { duration: 0.16, layers: [
  { waveform: 'sine', freq: 150, pitchBend: { to: 92, time: 0.05 }, filter: { type: 'lowpass', freq: 320, q: 1 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.03 }, gain: 0.2 },     // small muzzle thump (no sub-bass)
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1500, q: 0.9 }, adsr: { a: 0.0005, d: 0.045, s: 0, r: 0.02 }, gain: 0.26 },                              // dry, bright round-crack
  { waveform: 'sawtooth', freq: 1500, pitchBend: { to: 780, time: 0.09 }, filter: { type: 'bandpass', freq: 1600, q: 1.8 }, adsr: { a: 0.003, d: 0.06, s: 0, r: 0.03 }, gain: 0.022 },  // thin doppler zip downrange
  { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 3400, q: 0.7 }, adsr: { a: 0.0005, d: 0.02, s: 0, r: 0.015 }, gain: 0.03 } ] } };                        // muzzle snap
const GUN_LIGHT_FX_EXT = { config: { duration: 0.16, layers: [
  { waveform: 'sine', freq: 128, pitchBend: { to: 84, time: 0.05 }, filter: { type: 'lowpass', freq: 280, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.025 }, gain: 0.16 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1750, q: 0.9 }, adsr: { a: 0.0005, d: 0.05, s: 0, r: 0.025 }, gain: 0.32 },                              // sharper in open air
  { waveform: 'sawtooth', freq: 1750, pitchBend: { to: 860, time: 0.1 }, filter: { type: 'bandpass', freq: 1800, q: 1.8 }, adsr: { a: 0.003, d: 0.065, s: 0, r: 0.035 }, gain: 0.03 },
  { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 3600, q: 0.7 }, adsr: { a: 0.0005, d: 0.025, s: 0, r: 0.02 }, gain: 0.05 } ] } };
// `light` picks the chin turret's voice over the wing cannon's; `external` the open-air mix.
export function gunFx(external, light) {
  const ae = AE(); const def = light ? (external ? GUN_LIGHT_FX_EXT : GUN_LIGHT_FX) : (external ? GUN_FX_EXT : GUN_FX);
  try { ae?.init?.(); ae?.playSfx?.(def); } catch {}
}

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

// The AA GUN'S REPORT heard from altitude — the heavy Flak-88 bark of the battery firing on
// the ground BELOW you, distinct from tracerFx (the round whipping PAST you). A big low-
// velocity gun: a deep chest BOOM, a hard breech crack, and a long lowpassed tail that rolls
// out across the basin. `near` (0..1) is proximity to the gun: a close battery is a sharp,
// loud CRACK-BOOM; a distant one is a muffled far-off thud with a longer, softer roll. Because
// the report rolls UP from the ground it lands a touch behind the visual muzzle flash — which
// is exactly right (you see the flash, then the boom reaches you).
function aaGunFxDef(near) {
  const n = Math.max(0, Math.min(1, near));
  const crackF = 360 + n * 320;         // sharper, brighter crack up close
  const rollDelay = 0.1 - n * 0.05;     // a distant gun's report rolls in a hair later
  return { config: { duration: 0.85 - n * 0.1, layers: [
    // Sub-bass concussion — the punch of the muzzle blast.
    { waveform: 'sine', freq: 52, pitchBend: { to: 28, time: 0.16 }, filter: { type: 'lowpass', freq: 95, q: 1 }, adsr: { a: 0.002, d: 0.3, s: 0, r: 0.18 }, gain: 0.28 + n * 0.28 },
    // Muzzle body / breech thud.
    { waveform: 'sine', freq: 84, pitchBend: { to: 46, time: 0.13 }, filter: { type: 'lowpass', freq: 190, q: 1.1 }, adsr: { a: 0.002, d: 0.24, s: 0, r: 0.12 }, gain: 0.24 + n * 0.24 },
    { waveform: 'sawtooth', freq: 104, pitchBend: { to: 62, time: 0.1 }, filter: { type: 'lowpass', freq: 520, q: 1.2 }, adsr: { a: 0.001, d: 0.15, s: 0, r: 0.08 }, gain: 0.1 + n * 0.14 },
    // The sharp report crack of a high-velocity 88 — brighter/harder the closer you are.
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: crackF, q: 0.8 }, adsr: { a: 0.0006, d: 0.08 + n * 0.05, s: 0, r: 0.05 }, gain: 0.08 + n * 0.2 },
    // Rolling report tail — the boom rolling out across the landscape, delayed and lowpassed.
    { waveform: 'noise', noiseMix: 1, delay: rollDelay, filter: { type: 'lowpass', freq: 300 + n * 260, q: 0.7 }, adsr: { a: 0.02, d: 0.35 - n * 0.1, s: 0, r: 0.28 }, gain: 0.06 + n * 0.12 } ] } };
}
export function aaGunFx(near) { const ae = AE(); try { ae?.init?.(); ae?.playSfx?.(aaGunFxDef(near)); } catch {} }

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

// A SWARM ripple — `n` motors lighting one after another off the rails, not one launch played
// once. Each seeker gets its own ignition thump + tearing whoosh delayed by the same 120 ms
// stagger the missiles are drawn on (MSL_STAGGER_MS in cockpit.js), detuned a little per rail so
// they don't phase-lock into a single fat noise, and the whole ripple rolls out as one long tear.
// The tail rounds are quieter — by then you're hearing them leave, not go off beside you.
export function missileRippleFx(n, external) {
  const shots = Math.max(1, Math.min(8, n | 0));
  const layers = [];
  for (let i = 0; i < shots; i++) {
    const d = i * 0.12, det = 1 + (i % 3) * 0.06, fall = 1 - i * 0.06;   // per-rail detune + roll-off
    layers.push(
      { waveform: 'sine', freq: 96 * det, pitchBend: { to: 46, time: 0.14 }, delay: d, adsr: { a: 0.002, d: 0.18, s: 0, r: 0.09 }, gain: 0.1 * fall },
      { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2300 * det, q: 0.8 }, pitchBend: { to: 520, time: 0.9 }, delay: d, adsr: { a: 0.025, d: 0.75, s: 0.15, r: 0.2 }, gain: (external ? 0.075 : 0.06) * fall },
      { waveform: 'sawtooth', freq: 330 * det, pitchBend: { to: 120, time: 0.8 }, filter: { type: 'lowpass', freq: 900, q: 1 }, delay: d, adsr: { a: 0.02, d: 0.7, s: 0.08, r: 0.18 }, gain: 0.03 * fall },
    );
  }
  const ae = AE();
  try { ae?.init?.(); ae?.playSfx?.({ config: { duration: 1.3 + shots * 0.12, layers } }); } catch {}
}

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

// ── THE DIVE SIREN (the Shrike) ───────────────────────────────────────────────
// The wail. It is the aircraft's actual weapon as far as anyone on the ground is concerned,
// and it is a wind-driven siren in the leg fairings, so it is powered by the dive itself:
// nose down, speed up, and it climbs. `level` is 0..1 of dive commitment.
//
// ⚠ THE LOOP API HAS NO PITCH CONTROL — only setLoopGain. So the rise is built as THREE
// fixed-pitch layers, each its own loop, cross-faded by gain as the level climbs. That is the
// same trick the ground-roll bed uses, and it is deliberately not "add a setLoopRate": one
// rate-changing loop would need every consumer of the loop API to grow a param it has no other
// use for, to save three rows of a table.
//
// ⚠ EVERY ID HERE IS REGISTERED IN killLoops. These start independently of `running` (the
// continuous fixed-wing path never sets it), and they are on the ambient bus — which survives
// every mute — so an unregistered one drones forever after the panel closes. That is the exact
// bug the comment above killLoops was written about.
const SIREN_IDS = ['flt-siren-lo', 'flt-siren-mid', 'flt-siren-hi'];
let _sirenOn = false;
function sirenLayer(id, f0, f1) {
  return { id, category: 'ambient', config: { gain: 1, layers: [
    { waveform: 'sawtooth', freq: f0, filter: { type: 'bandpass', freq: f0 * 2.1, q: 5 }, adsr: { a: 0.08, d: 0, s: 1, r: 0.20 }, gain: 0.085 },
    { waveform: 'sawtooth', freq: f1, filter: { type: 'bandpass', freq: f1 * 1.9, q: 6 }, adsr: { a: 0.08, d: 0, s: 1, r: 0.20 }, gain: 0.055 },
    // The wind roar the siren is riding on — without it the layers read as three organ notes
    // rather than as air being forced through something.
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: f0 * 1.4, q: 1.1 }, adsr: { a: 0.12, d: 0, s: 1, r: 0.25 }, gain: 0.030 } ] } };
}
export function diveSiren(level) {
  const ae = AE(); if (!ae) return;
  const L = Math.max(0, Math.min(1, level || 0));
  if (L > 0 && !_sirenOn) {
    try {
      ae.loopSound(sirenLayer('flt-siren-lo', 300, 452));
      ae.loopSound(sirenLayer('flt-siren-mid', 470, 706));
      ae.loopSound(sirenLayer('flt-siren-hi', 720, 1082));
    } catch { /* no audio */ }
    _sirenOn = true;
  }
  if (!_sirenOn) return;
  // Triangular cross-fade across the three layers: at L=0 nothing, L=0.5 the middle alone,
  // L=1 the top alone — with the neighbours bleeding through in between so the climb is
  // continuous rather than three audible steps. Overall gain also rises with L, because a
  // siren that is winding up is getting LOUDER as well as higher.
  const w = (c) => Math.max(0, 1 - Math.abs(L - c) / 0.5);
  const amp = 0.30 + 0.55 * L;
  ae.setLoopGain?.('flt-siren-lo', w(0.12) * amp, 0.08);
  ae.setLoopGain?.('flt-siren-mid', w(0.55) * amp, 0.08);
  ae.setLoopGain?.('flt-siren-hi', w(1.00) * amp, 0.08);
}

// ── DAMAGE, AS A SOUND ───────────────────────────────────────────────────────
// A truck that is coming apart should be audible from the driver's seat before it is legible on a
// gauge, because that is the order it happens in real life: you hear it, then you look.
//
// TWO HALVES, and they answer different questions.
//
//   `damageCue(part, band)`  — a ONE-SHOT at the moment a component crosses into a worse band.
//                              This is the event. It is per PART because a wheel letting go and an
//                              engine starting to knock are not the same noise and a driver has to
//                              be able to tell them apart with their eyes on the road.
//   `damageBed(dmg)`         — a CONTINUOUS layer for living with it. Scales with how bad the
//                              worst component is, so the sound is the gauge.
//
// ⚠ THE SCALE IS THE CONDITION NUMBER, NOT A SECOND ONE. Everything in this system reads 1 = sound
// and 0 = failed (the bands, the HUD, the resale price, the repair bill), so this does too and the
// gain runs on `1 - condition`. Saying it once, backwards, in the audio layer is exactly how a
// system ends up with two vocabularies and a driver who trusts neither.
const DMG_CUES = {
  // The engine: a knock arriving. A hard low rap with a metallic ring after it, because what you
  // are hearing is a bearing that has stopped being round.
  engine: { config: { duration: 0.9, layers: [
    { waveform: 'square', freq: 84, pitchBend: { to: 52, time: 0.06 }, filter: { type: 'lowpass', freq: 420, q: 2.4 }, adsr: { a: 0.002, d: 0.10, s: 0, r: 0.06 }, gain: 0.13 },
    { waveform: 'triangle', freq: 210, filter: { type: 'bandpass', freq: 900, q: 4 }, adsr: { a: 0.004, d: 0.30, s: 0, r: 0.2 }, gain: 0.06 },
    { waveform: 'noise', noiseMix: 1, delay: 0.03, filter: { type: 'bandpass', freq: 1600, q: 1.2 }, adsr: { a: 0.01, d: 0.22, s: 0, r: 0.15 }, gain: 0.05 } ] } },
  // The lifters: an emitter face going out of phase. A wobble rather than an impact — the note is
  // wrong before it is loud, which is what a failing hover pod actually does.
  wheels: { config: { duration: 1.2, layers: [
    { waveform: 'sawtooth', freq: 120, pitchBend: { to: 96, time: 0.5 }, vibrato: { rate: 11, depth: 22 }, filter: { type: 'bandpass', freq: 700, q: 2 }, adsr: { a: 0.03, d: 0.7, s: 0.2, r: 0.3 }, gain: 0.09 },
    { waveform: 'sine', freq: 47, tremolo: { rate: 13, depth: 0.7 }, adsr: { a: 0.04, d: 0.8, s: 0.2, r: 0.3 }, gain: 0.07 } ] } },
  // The body: sheet metal letting go somewhere behind you. A tearing scrape with a panel boom.
  body: { config: { duration: 1.0, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2400, q: 0.8 }, adsr: { a: 0.01, d: 0.5, s: 0.1, r: 0.3 }, gain: 0.10 },
    { waveform: 'triangle', freq: 62, pitchBend: { to: 40, time: 0.3 }, filter: { type: 'lowpass', freq: 300, q: 1.4 }, adsr: { a: 0.006, d: 0.45, s: 0, r: 0.25 }, gain: 0.09 } ] } },
  // The box behind you, which you hear through the mirror more than through the frame.
  trailer: { config: { duration: 1.1, layers: [
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1200, q: 0.7 }, adsr: { a: 0.02, d: 0.6, s: 0.1, r: 0.35 }, gain: 0.08 },
    { waveform: 'square', freq: 54, tremolo: { rate: 6, depth: 0.6 }, filter: { type: 'lowpass', freq: 260, q: 1.2 }, adsr: { a: 0.01, d: 0.7, s: 0.1, r: 0.3 }, gain: 0.07 } ] } },
};
// A worse band gets a louder, harder version of the SAME cue rather than a different sound. The
// part is the identity; the band is the volume of the news.
const BAND_GAIN = { worked: 0.55, tired: 0.75, ailing: 1.0, derelict: 1.25 };
export function damageCue(part, band = 'tired') {
  const ae = AE(); const def = DMG_CUES[part]; if (!def) return;
  const g = BAND_GAIN[band] ?? 0.8;
  try {
    ae?.init?.();
    ae?.playSfx?.({ config: { ...def.config, layers: def.config.layers.map((l) => ({ ...l, gain: (l.gain || 0.1) * g })) } });
  } catch { /* no audio */ }
}

// The fault bed: what continuing to drive on it sounds like. One loop, gain and character driven by
// the WORST component, so a truck with one dying part sounds like a truck with a dying part — which
// is the same rule `overall` follows for the headline number, and for the same reason.
let _dmgBed = false;
export function damageBed(dmg, engineOn = true) {
  const ae = AE(); if (!ae) return;
  const worst = Math.min(1, Math.max(0, Math.min(
    dmg?.engine ?? 1, dmg?.wheels ?? 1, dmg?.body ?? 1)));
  const hurt = 1 - worst;
  // Nothing under a fifth gone is worth a noise: a truck with a scratch on it is a quiet truck, and
  // a bed that fades in at 99% condition would just be tinnitus with a changelog.
  if (!engineOn || hurt < 0.20) {
    if (_dmgBed) { try { ae.setLoopGain?.('trk-damage', 0, 0.8); } catch {} _dmgBed = false; }
    return;
  }
  if (!_dmgBed) {
    try {
      ae.init?.();
      ae.loopSound({ id: 'trk-damage', category: 'ambient', config: { gain: 1, layers: [
        // A rattle that gets less regular as it gets worse: the tremolo rate is the tell.
        { waveform: 'square', freq: 58, tremolo: { rate: 7, depth: 0.8 }, filter: { type: 'lowpass', freq: 320, q: 1.6 }, gain: 0.05 },
        // And a dry grind underneath it.
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 900, q: 0.8 }, tremolo: { rate: 3.5, depth: 0.5 }, gain: 0.04 },
      ] } });
      _dmgBed = true;
    } catch { return; }
  }
  // Quadratic, so the last quarter of the bar is where it really starts shouting — the same shape
  // the condition bands use, where the bottom two are much worse than the top three are good.
  try { ae.setLoopGain?.('trk-damage', Math.min(0.9, hurt * hurt * 1.6), 0.5); } catch {}
}
export function stopDamageBed() { const ae = AE(); if (_dmgBed) { try { ae?.stopLoop?.('trk-damage'); } catch {} _dmgBed = false; } }
