// Yacht ambience — the Echelon's location-gated soundscape. The server tags each room's look/move
// with `ambience`: 'naval' on the open decks, 'engine' in the engine spaces, null everywhere else.
// The engine bed (a live diesel/osc graph on the ambient bus) idles ONLY in the engine spaces — a
// low constant drone you hear standing over the machinery. Everywhere else aboard (open decks, the
// suites, corridors) she's SILENT at a dead stop, and only sounds when she's making way (the roar).
// 'naval' is the HARBOR: a real-time Yamaha-style FM synth built directly on the AudioEngine's
// ambient bus via engineNodes() (same seam the flight engine uses) — every gull, bell, fog horn,
// creak, rope, hull knock, splash and gust is generated from operators (sine carriers + FM
// modulators, feedback, ADSR + modulation-index + pitch envelopes, LFO vibrato), then placed in
// space through a per-voice distance model (gain → low-pass → stereo width → reverb send).
//
// See docs: the spec is "stylized realism" — instantly recognisable, unmistakably synthetic. Sines
// dominate; feedback is approximated by blending a little sawtooth into a modulator (Web Audio has
// no per-operator feedback path, and a DelayNode self-loop only gives a quantum-delayed artifact —
// the saw blend is the stable way to get the brightening a DX feedback operator produces). Voices
// steal the oldest when the 8-voice budget is full. Nothing here uses recorded samples.

const AE = () => window.AudioEngine;

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const c2r = (cents) => Math.pow(2, cents / 1200);           // cents → frequency multiplier
const vary = (v, pct) => v * (1 + rnd(-pct, pct));           // ±pct proportional jitter

// ═══════════════════════════════════════════════════════════════════════════
//  Harbor FM synth
// ═══════════════════════════════════════════════════════════════════════════
let ctx = null, bus = null, noiseBuf = null;   // from engineNodes()
let harborOut = null, reverbReturn = null, reverb = null;
const voices = new Set();
const MAX_VOICES = 8;

// Shared ctx/bus/noise grab (used by both the harbor synth and the engine loop) — the engine can
// run without the harbor (e.g. standing in the engine room), so this is factored out of audio().
function ensureNodes() {
  if (ctx && bus) return true;
  const ae = AE(); if (!ae?.engineNodes) return false;
  ae.init?.();
  const eng = ae.engineNodes(); if (!eng?.ctx || !eng.bus) return false;
  ctx = eng.ctx; bus = eng.bus; noiseBuf = eng.noise;
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} }
  return true;
}
function audio() {
  if (ctx && harborOut) return true;
  if (!ensureNodes()) return false;
  buildBusChain();
  return !!harborOut;
}

// Dry sum + a shared "large harbor" convolution reverb (synthesised impulse: exp-decayed noise).
function buildBusChain() {
  harborOut = ctx.createGain(); harborOut.gain.value = 0.9; harborOut.connect(bus);
  const seconds = 2.6, len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  reverb = ctx.createConvolver(); reverb.buffer = ir;
  const pre = ctx.createBiquadFilter(); pre.type = 'lowpass'; pre.frequency.value = 3200;   // dark, spacious
  reverbReturn = ctx.createGain(); reverbReturn.gain.value = 0.9;
  reverb.connect(pre).connect(reverbReturn).connect(bus);
}

// ── Voice: output chain + polyphony/lifecycle ────────────────────────────────
// carriers connect to `.in`; the chain applies distance (gain→LPF→pan) then splits dry/reverb.
function makeVoice(distM, basePan, reverbSend) {
  const vin = ctx.createGain(); vin.gain.value = 1;
  const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass';
  const pan = ctx.createStereoPanner();
  const send = ctx.createGain();
  const d = distParams(distM);
  lpf.frequency.value = d.lpf;
  pan.pan.value = Math.max(-1, Math.min(1, basePan * d.width));
  send.gain.value = Math.min(0.95, reverbSend + d.rev);
  vin.gain.value = d.gain;
  vin.connect(lpf).connect(pan);
  pan.connect(harborOut);
  pan.connect(send).connect(reverb);
  const srcs = [];
  const v = {
    in: vin,
    add(node) { srcs.push(node); return node; },
    play(t0, tEnd) {
      for (const s of srcs) { try { s.start(t0); } catch {} try { s.stop(tEnd + 0.12); } catch {} }
      voices.add(v);
      const ms = Math.max(150, (tEnd - ctx.currentTime + 0.4) * 1000);
      setTimeout(() => v.dispose(), ms);
    },
    steal() {
      const t = ctx.currentTime;
      try { vin.gain.cancelScheduledValues(t); vin.gain.setTargetAtTime(0, t, 0.05); } catch {}
      for (const s of srcs) { try { s.stop(t + 0.2); } catch {} }
      setTimeout(() => v.dispose(), 300);
    },
    dispose() {
      if (!voices.has(v)) return;
      voices.delete(v);
      try { vin.disconnect(); lpf.disconnect(); pan.disconnect(); send.disconnect(); } catch {}
    },
  };
  if (voices.size >= MAX_VOICES) { const oldest = voices.values().next().value; oldest?.steal(); }
  return v;
}

// Distance model — gain, low-pass cutoff, stereo-width factor, reverb-send bias.
function distParams(m) {
  const lpf = m <= 5 ? 18000 : m <= 20 ? 18000 + (9000 - 18000) * (m - 5) / 15
    : m <= 50 ? 9000 + (5000 - 9000) * (m - 20) / 30 : m <= 100 ? 5000 + (2500 - 5000) * (m - 50) / 50
    : m <= 250 ? 2500 + (1200 - 2500) * (m - 100) / 150 : 1200;
  const width = m <= 5 ? 1 : m <= 20 ? 1 - 0.2 * (m - 5) / 15 : m <= 50 ? 0.8 - 0.3 * (m - 20) / 30
    : m <= 100 ? 0.5 - 0.3 * (m - 50) / 50 : m <= 250 ? 0.2 - 0.2 * (m - 100) / 150 : 0;
  const gain = Math.min(1, 16 / (m + 11));                 // near-cap, then inverse-ish falloff
  const rev = Math.min(0.6, m / 260);
  return { lpf, width, gain, rev };
}

// ── Operators ────────────────────────────────────────────────────────────────
// An operator is a sine oscillator + an output gain. A feedback operator blends a little sawtooth
// (see header) at the same frequency to approximate DX feedback brightening.
function makeOp(freq, { wave = 'sine', fb = 0 } = {}) {
  const o = ctx.createOscillator(); o.type = wave; o.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = 0;
  o.connect(g);
  const oscs = [o];
  if (fb > 0) {
    const s = ctx.createOscillator(); s.type = 'sawtooth'; s.frequency.value = freq;
    const sg = ctx.createGain(); sg.gain.value = Math.min(0.6, fb / 7);
    s.connect(sg).connect(g);
    oscs.push(s);
  }
  return { o, g, oscs, freq };
}
const fm = (mod, carrier) => mod.g.connect(carrier.o.frequency);          // modulation depth = mod.g.gain (Hz)
const opFreq = (op, hz, t) => op.oscs.forEach((o) => o.frequency.setValueAtTime(hz, t));
const opGlide = (op, hz, t, tc) => op.oscs.forEach((o) => o.frequency.setTargetAtTime(hz, t, tc));
const opDetune = (op, cents, t) => op.oscs.forEach((o) => o.detune.setValueAtTime(cents, t));

// Amplitude ADSR on a carrier's output gain; returns the note-end time.
function adsr(g, t0, peak, a, d, s, hold, r) {
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  const dEnd = t0 + a + d;
  g.gain.linearRampToValueAtTime(peak * s, dEnd);
  const rStart = dEnd + hold;
  g.gain.setValueAtTime(peak * s, rStart);
  g.gain.linearRampToValueAtTime(0, rStart + r);
  return rStart + r;
}
// Struck/plucked exponential ring (bell, hull) — instant peak, e-folding tail. Returns ~end time.
function pluck(g, t0, peak, tc) { g.gain.setValueAtTime(peak, t0); g.gain.setTargetAtTime(0, t0, tc); return t0 + tc * 5; }

// A sine/triangle LFO onto a set of ops' detune (vibrato), with optional fade-in.
function vibrato(v, ops, wave, rate, depthCents, t0, fadeIn = 0) {
  const lfo = ctx.createOscillator(); lfo.type = wave; lfo.frequency.value = rate;
  const dg = ctx.createGain();
  if (fadeIn > 0) { dg.gain.setValueAtTime(0, t0); dg.gain.linearRampToValueAtTime(depthCents, t0 + fadeIn); }
  else dg.gain.value = depthCents;
  lfo.connect(dg);
  for (const op of ops) for (const o of op.oscs) dg.connect(o.detune);
  v.add(lfo);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Patches
// ═══════════════════════════════════════════════════════════════════════════

// 1. SEAGULL — C1(1.00)+C2(2.00) carriers; M1(3.50) vocal formant → C1; M2(7.00, fb) attack rasp.
//    +120→−500c pitch env over 650ms ("KYEEE-aaah"), 6 Hz vibrato faded in over 150ms.
function gull(distM) {
  if (!harborOut) return;
  const t = ctx.currentTime + 0.01;
  const f0 = vary(rnd(760, 1180), 0.03);
  const v = makeVoice(distM, rnd(-0.9, 0.9), 0.12);
  const C1 = makeOp(f0), C2 = makeOp(f0 * 2), M1 = makeOp(vary(f0 * 3.5, 0.05)), M2 = makeOp(vary(f0 * 7, 0.05), { fb: rnd(2, 3) });
  fm(M2, M1); fm(M1, C1);
  C1.g.connect(v.in); C2.g.connect(v.in);
  M1.g.gain.value = vary(f0 * 3.5 * 1.2, 0.1);          // moderate index
  // M2 rasp only during the attack: quick swell then gone
  M2.g.gain.setValueAtTime(0, t); M2.g.gain.linearRampToValueAtTime(f0 * 2.2, t + 0.01); M2.g.gain.setTargetAtTime(0, t + 0.02, 0.06);
  const a = vary(0.008, 0.1), r = vary(0.35, 0.15);
  const e1 = adsr(C1.g, t, vary(0.5, 0.05), a, 0.22, 0.45, 0.14, r);
  adsr(C2.g, t, vary(0.5, 0.05) * 0.25, a, 0.22, 0.45, 0.14, r);
  // pitch env, ratio-locked across all ops
  for (const [op, ratio] of [[C1, 1], [C2, 2], [M1, 3.5], [M2, 7]]) {
    opFreq(op, f0 * ratio * c2r(120), t);
    opGlide(op, f0 * ratio * c2r(-500), t + 0.02, 0.22);
  }
  vibrato(v, [C1, C2], 'sine', vary(6, 0.5 / 6), vary(12, 0.2), t, 0.15);
  v.play(t, e1);
}
function gullEvent(distM) {
  const d = distM ?? rnd(2, 40);
  gull(d);
  if (chance(0.05)) setTimeout(() => gull(vary(d, 0.2)), rnd(250, 600));
  if (chance(0.02)) { const n = 3 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) setTimeout(() => gull(vary(d, 0.3)), rnd(200, 700) * i); }
}

// 2. FOG HORN — C(1.00) + very-low-index M(1.00) + faint M2(2.00) 2nd-harmonic reinforcement.
//    700ms attack / 3s hold / 4s release, index swells +20% during attack, 0.18 Hz triangle vibrato
//    ±2c, always distant (heavy LPF + big reverb). Optional lower two-tone answer.
let foghornBusy = false;
function foghornBlast(freq, distM) {
  if (!harborOut) return ctx ? ctx.currentTime : 0;
  const t = ctx.currentTime + 0.01;
  const v = makeVoice(distM, rnd(-0.15, 0.15), 0.65);
  const C = makeOp(freq), M = makeOp(freq), M2 = makeOp(freq * 2);
  fm(M, C); fm(M2, C);
  C.g.connect(v.in);
  const a = vary(0.7, 0.1), r = vary(4, 0.15);
  const idx0 = freq * 0.10;
  M.g.gain.setValueAtTime(idx0, t); M.g.gain.linearRampToValueAtTime(idx0 * 1.2, t + a); M.g.gain.setTargetAtTime(idx0, t + a, 1.5);
  M2.g.gain.value = freq * 0.05;
  const end = adsr(C.g, t, 0.42, a, 0, 1, 3, r);
  vibrato(v, [C], 'triangle', 0.18, 2, t);
  v.play(t, end);
  return end;
}
function foghorn() {
  if (foghornBusy) return;
  foghornBusy = true;
  const dist = rnd(120, 240), base = vary(rnd(88, 120), 0.03);
  const end = foghornBlast(base, dist);
  if (chance(0.5)) setTimeout(() => foghornBlast(base * rnd(0.72, 0.8), dist), rnd(1400, 2000));
  setTimeout(() => { foghornBusy = false; }, (end - ctx.currentTime + 3) * 1000);
}

// 3. NAVIGATION / BUOY BELL — C(1.00), MA(8.00) strike, MB(11.50) inharmonic ring, fb 3.
//    Instant attack, ~4s decay + long tail; modulation index falls to 20% over the decay (bright
//    strike → smooth lingering resonance). No vibrato — small random pitch drift instead.
function bellStrike(freq, distM) {
  if (!harborOut) return ctx ? ctx.currentTime : 0;
  const t = ctx.currentTime + 0.005;
  const v = makeVoice(distM, rnd(-0.7, 0.7), 0.4);
  // The metallic strike/ring comes from the inharmonic 8.0 / 11.5 ratios at high index; no saw-blend
  // feedback on the carrier (it's the FM-modulated operator, where an unmodulated saw would just drone).
  const C = makeOp(freq), MA = makeOp(vary(freq * 8, 0.02)), MB = makeOp(vary(freq * 11.5, 0.02));
  fm(MA, C); fm(MB, C);
  C.g.connect(v.in);
  const iA = freq * 5, iB = freq * 3.5;
  MA.g.gain.setValueAtTime(iA, t); MA.g.gain.setTargetAtTime(iA * 0.2, t, 1.3);
  MB.g.gain.setValueAtTime(iB, t); MB.g.gain.setTargetAtTime(iB * 0.2, t, 1.1);
  const end = pluck(C.g, t, vary(0.5, 0.05), vary(1.5, 0.15));
  // random pitch drift ±3c across the decay
  for (let k = 1; k <= 6; k++) opDetune(C, rnd(-3, 3), t + k * 0.7);
  v.play(t, end);
  return end;
}
function bell() {
  const dist = rnd(30, 120), base = vary(rnd(320, 780), 0.03);
  bellStrike(base, dist);
  if (chance(0.4)) setTimeout(() => bellStrike(vary(base, 0.01), dist), rnd(700, 1200));  // buoy rocks on the swell
}

// 4. DOCK CREAK — triangle-ish carrier(1.00) + slow M(0.50); 600ms attack, downward −150c glide
//    with 20-cent random jumps; shallow 0.25 Hz triangle LFO.
function creak() {
  if (!harborOut) return;
  const t = ctx.currentTime + 0.01;
  const f0 = vary(rnd(120, 240), 0.03), dist = rnd(5, 30);
  const v = makeVoice(dist, rnd(-0.6, 0.6), 0.2);
  const C = makeOp(f0, { wave: 'triangle' }), M = makeOp(f0 * 0.5);
  fm(M, C); C.g.connect(v.in);
  M.g.gain.value = f0 * 0.6;
  const end = adsr(C.g, t, vary(0.16, 0.1), 0.6, 2, 0.3, 0, 1);
  opFreq(C, f0, t); opGlide(C, f0 * c2r(-150), t + 0.1, 0.7);
  for (let k = 1; k <= 5; k++) opDetune(C, rnd(-20, 20), t + k * 0.4);
  vibrato(v, [C], 'triangle', 0.25, 8, t);
  v.play(t, end);
}

// 5. MOORING ROPE WHISTLE — pure sine C(1.00) + low-index M(5.00) narrow whistle; slow ±80c random
//    walk, 0.6 Hz triangle vibrato 15c; drifts into existence (long attack + release).
function ropeWhistle() {
  if (!harborOut) return;
  const t = ctx.currentTime + 0.01;
  const f0 = vary(rnd(500, 900), 0.03), dist = rnd(20, 60);
  const v = makeVoice(dist, rnd(-0.5, 0.5), 0.35);
  const C = makeOp(f0), M = makeOp(vary(f0 * 5, 0.05));
  fm(M, C); C.g.connect(v.in);
  M.g.gain.value = f0 * 0.4;
  const end = adsr(C.g, t, vary(0.05, 0.1), 2.2, 0, 1, 3, 3);
  let cur = 0;
  for (let k = 1; k <= 8; k++) { cur = Math.max(-80, Math.min(80, cur + rnd(-30, 30))); opGlide(C, f0 * c2r(cur), t + k * 0.9, 0.6); }
  vibrato(v, [C], 'triangle', vary(0.6, 0.5 / 0.6), 15, t, 1.5);
  v.play(t, end);
}

// 6. HULL IMPACT — C(1.00) + strong M(6.00) attack + M2(2.00) body resonance; instant attack,
//    ~900ms decay, 3s release → "TING… BOOOONG": the high FM strike collapses into a low body tone.
function hullImpact() {
  if (!harborOut) return;
  const t = ctx.currentTime + 0.005;
  const f0 = vary(rnd(60, 96), 0.03), dist = rnd(40, 160);
  const v = makeVoice(dist, rnd(-0.4, 0.4), 0.45);
  const C = makeOp(f0), M = makeOp(vary(f0 * 6, 0.05)), M2 = makeOp(f0 * 2);
  fm(M, C); fm(M2, C); C.g.connect(v.in);
  const iM = f0 * 8;
  M.g.gain.setValueAtTime(iM, t); M.g.gain.setTargetAtTime(iM * 0.05, t, 0.18);   // bright TING collapses fast
  M2.g.gain.setValueAtTime(f0 * 2, t); M2.g.gain.setTargetAtTime(f0 * 0.6, t, 0.9);
  const end = pluck(C.g, t, vary(0.55, 0.05), 0.9);
  // small noise transient on the strike
  const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
  const nlp = ctx.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 240;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.05, t); ng.gain.setTargetAtTime(0, t, 0.04);
  n.connect(nlp).connect(ng).connect(v.in); v.add(n);
  v.play(t, end);
}

// 7. WATER — many tiny FM splashes (never a noise loop): C(1.00)+M(2.00), very short attack, ~80ms
//    decay, random 100–350 Hz, plus a 20ms noise chip.
function splash() {
  if (!harborOut) return;
  const t = ctx.currentTime + 0.005;
  const f0 = rnd(100, 350), dist = rnd(2, 25);
  const v = makeVoice(dist, rnd(-1, 1), 0.15);
  const C = makeOp(f0), M = makeOp(f0 * 2);
  fm(M, C); C.g.connect(v.in);
  M.g.gain.setValueAtTime(f0 * 1.5, t); M.g.gain.setTargetAtTime(f0 * 0.3, t, 0.03);
  C.g.gain.setValueAtTime(0, t); C.g.gain.linearRampToValueAtTime(vary(0.05, 0.15), t + 0.004); C.g.gain.setTargetAtTime(0, t + 0.004, 0.028);
  const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
  const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = f0 * 4; nbp.Q.value = 2;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.03, t); ng.gain.setTargetAtTime(0, t, 0.008);
  n.connect(nbp).connect(ng).connect(v.in); v.add(n);
  v.play(t, t + 0.2);
}
function water() { const n = 1 + (chance(0.3) ? 1 + Math.floor(Math.random() * 2) : 0); for (let i = 0; i < n; i++) setTimeout(splash, i * rnd(60, 200)); }

// 8. WIND — persistent base: filtered noise (LP 3–6 kHz) + faint sine drone, a 0.08 Hz triangle LFO
//    doing amplitude (15%) + filter (20%) modulation. Gusts brighten/swell for a few seconds.
let wind = null;
function startWind() {
  if (wind) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500; lp.Q.value = 0.4;
  const g = ctx.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(0.05, t + 2.5);
  src.connect(lp).connect(g).connect(harborOut);
  const wSend = ctx.createGain(); wSend.gain.value = 0.25; g.connect(wSend).connect(reverb);   // modest wet
  const drone = ctx.createOscillator(); drone.type = 'sine'; drone.frequency.value = 70;
  const dg = ctx.createGain(); dg.gain.value = 0; dg.gain.linearRampToValueAtTime(0.012, t + 3);
  drone.connect(dg).connect(harborOut);
  // 0.08 Hz triangle LFO → amplitude (±15%) and filter cutoff (±20%)
  const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 0.08;
  const amDepth = ctx.createGain(); amDepth.gain.value = 0.05 * 0.15; lfo.connect(amDepth).connect(g.gain);
  const fmDepth = ctx.createGain(); fmDepth.gain.value = 4500 * 0.2; lfo.connect(fmDepth).connect(lp.frequency);
  src.start(t); drone.start(t); lfo.start(t);
  wind = { src, drone, lfo, lp, g, base: 0.05, cutoff: 4500 };
}
function windGust() {
  if (!wind) return;
  const t = ctx.currentTime, dur = rnd(4, 8);
  wind.g.gain.cancelScheduledValues(t);
  wind.g.gain.setValueAtTime(wind.g.gain.value, t);
  wind.g.gain.linearRampToValueAtTime(wind.base * 1.15, t + dur * 0.4);
  wind.g.gain.linearRampToValueAtTime(wind.base, t + dur);
  wind.lp.frequency.cancelScheduledValues(t);
  wind.lp.frequency.setValueAtTime(wind.lp.frequency.value, t);
  wind.lp.frequency.linearRampToValueAtTime(wind.cutoff * 1.1, t + dur * 0.4);
  wind.lp.frequency.linearRampToValueAtTime(wind.cutoff, t + dur);
}
function stopWind() {
  if (!wind) return;
  const w = wind; wind = null; const t = ctx.currentTime;
  try { w.g.gain.cancelScheduledValues(t); w.g.gain.setTargetAtTime(0, t, 0.4); } catch {}
  setTimeout(() => { for (const n of [w.src, w.drone, w.lfo]) { try { n.stop(); } catch {} } }, 1200);
}

// ── Weighted-random scheduler (self-rescheduling timers, ±jitter, occasional clusters) ────────
// [meanMin, meanMax] seconds; the range already carries the spread, ±0.5 jitter widens it further.
const SCHED = {
  water:  [2, 8,   water],
  gust:   [20, 40, windGust],
  gull:   [20, 75, () => gullEvent()],
  creak:  [40, 120, () => cluster(creak)],
  hull:   [60, 240, () => cluster(hullImpact)],
  bell:   [120, 480, bell],
  fog:    [240, 600, foghorn],
  rope:   [360, 900, ropeWhistle],
};
let timers = [];
// Related-sound cluster: fire the event, then sometimes tail it with a nearby knock/creak, so the
// harbor comes in little flurries between long silences.
function cluster(fn) {
  fn();
  if (chance(0.35)) setTimeout(() => (chance(0.5) ? creak() : hullImpact()), rnd(400, 1500));
}
function schedule(key) {
  const [min, max, fn] = SCHED[key];
  const wait = rnd(min, max) * rnd(0.5, 1.5) * 1000;
  const id = setTimeout(() => { try { if (ctx) fn(); } catch {} schedule(key); }, wait);
  timers.push(id);
}
function startHarbor() {
  if (!audio()) return;
  startWind();
  timers.forEach(clearTimeout); timers = [];
  for (const key of Object.keys(SCHED)) schedule(key);
}
function stopHarbor() {
  timers.forEach(clearTimeout); timers = [];
  stopWind();
  if (harborOut) { const t = ctx.currentTime; try { harborOut.gain.cancelScheduledValues(t); harborOut.gain.setTargetAtTime(0, t, 0.4); } catch {} }
  // Tear the bus chain down after tails ring out so a re-enter rebuilds cleanly.
  setTimeout(() => {
    for (const v of [...voices]) v.dispose();
    try { harborOut?.disconnect(); reverb?.disconnect(); reverbReturn?.disconnect(); } catch {}
    harborOut = reverb = reverbReturn = null;
    foghornBusy = false;
  }, 1400);
}

// ── Engine bed + making-way roar ─────────────────────────────────────────────
// The engine is a live node graph built straight on the ambient bus (like the harbor synth), so it
// owns a MASTER MUFFLE lowpass whose cutoff follows the room you're standing in: bright & present on
// the open deck and in the engine room, low-passed to a muffled thump in the cabins behind doors.
// That's the "heard throughout the ship, muffled behind doors" model. Layers: a sub-bass rumble
// (felt), a chugging diesel whose sawtooth harmonics carry the audible mid-range, and a filtered-
// noise wash that rises with way (so she plainly sounds like she's MOVING, not just idling).
//   graph:  [subs + diesel(chug) + wash] → sum → muffle(lowpass) → master(gain) → ambient bus
// Two gain drivers pick the master level: `engFloor` (steady engine-room bed) and `engRoar` (the
// making-way roar during a passage, heard everywhere aboard). The wash rides engRoar specifically.
let engFloor = 0;                 // steady engine-room bed (0 in every other zone)
let engRoar = 0, engGain = 0;     // current making-way roar + the eased master gain
let roarLevel = 0, roarUntil = 0; // passage roar target + when it ends (arrival)
let engTimer = null, lastT = 0;
let engNodes = null;              // { master, muffle, washG, srcs } once built
let muffleTarget = 650;           // lowpass cutoff for the CURRENT zone (open→bright, cabin→muffled)

// Cutoff (Hz) by the room you're in: engine room wide open, open deck fairly bright, everywhere else
// (interior cabins/corridors, all behind doors) heavily muffled so you hear a low thump, not detail.
const muffleFor = (k) => k === 'engine' ? 7000 : k === 'naval' ? 5200 : 650;

function engBuild() {
  if (engNodes) return true;
  if (!ensureNodes()) return false;
  const t = ctx.currentTime;
  const master = ctx.createGain(); master.gain.value = 0;
  const muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = muffleTarget; muffle.Q.value = 0.6;
  muffle.connect(master); master.connect(bus);
  const sum = ctx.createGain(); sum.gain.value = 1; sum.connect(muffle);
  const srcs = [];
  // Sub-bass rumble — felt more than heard; always passes the muffle.
  for (const [f, g] of [[42, 0.6], [63, 0.4], [84, 0.18]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const gn = ctx.createGain(); gn.gain.value = g; o.connect(gn).connect(sum); o.start(t); srcs.push(o);
  }
  // Diesel — three slightly detuned saws (their harmonics are the audible engine mids) through a
  // fairly open lowpass so the grunt and clatter carry. A STEADY roar, not a chug: a very slow, very
  // shallow LFO gives it a faint breath of life without any audible "chug-chug" pulse.
  const dieselG = ctx.createGain(); dieselG.gain.value = 0.3;
  const dieselLP = ctx.createBiquadFilter(); dieselLP.type = 'lowpass'; dieselLP.frequency.value = 2800; dieselLP.Q.value = 0.6;
  dieselLP.connect(dieselG).connect(sum);
  for (const f of [45.2, 46.4, 47.6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(dieselLP); o.start(t); srcs.push(o); }
  // A low square doubling adds the hollow "thump" of cylinders firing under the saw grunt.
  { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 46.4; const og = ctx.createGain(); og.gain.value = 0.09; o.connect(og).connect(dieselLP); o.start(t); srcs.push(o); }
  const chug = ctx.createOscillator(); chug.type = 'triangle'; chug.frequency.value = 0.35;
  const chugD = ctx.createGain(); chugD.gain.value = 0.03; chug.connect(chugD).connect(dieselG.gain); chug.start(t); srcs.push(chug);
  // Wash — filtered-noise water/air rush, gain ridden by engRoar each tick (silent at a dead stop).
  const wash = ctx.createBufferSource(); wash.buffer = noiseBuf; wash.loop = true;
  const washBP = ctx.createBiquadFilter(); washBP.type = 'bandpass'; washBP.frequency.value = 520; washBP.Q.value = 0.5;
  const washG = ctx.createGain(); washG.gain.value = 0;
  wash.connect(washBP).connect(washG).connect(sum); wash.start(t); srcs.push(wash);
  engNodes = { master, muffle, washG, srcs };
  return true;
}
function engTeardown() {
  if (!engNodes) return;
  const c = ctx ? ctx.currentTime : 0;
  for (const s of engNodes.srcs) { try { s.stop(c + 0.05); } catch {} }
  try { engNodes.master.disconnect(); engNodes.muffle.disconnect(); } catch {}
  engNodes = null; engGain = 0;
}
function engTick() {
  const now = performance.now(), dt = Math.min(1, (now - lastT) / 1000); lastT = now;
  if (roarUntil && now < roarUntil) engRoar += (roarLevel - engRoar) * Math.min(1, dt * 0.55);   // roar to life over ~a few seconds, then hold
  else { engRoar = Math.max(0, engRoar - dt * 0.4); if (engRoar < 0.01) engRoar = 0; }            // settle back to quiet on arrival
  const target = Math.max(engFloor, engRoar);
  if (target > 0.002 && !engBuild()) return;   // build lazily on first need; bail if audio isn't ready yet
  engGain += (target - engGain) * Math.min(1, dt * 2.4);
  if (engNodes) {
    const c = ctx.currentTime;
    engNodes.master.gain.setTargetAtTime(engGain, c, 0.2);
    engNodes.washG.gain.setTargetAtTime(Math.min(0.5, engRoar * 0.55), c, 0.25);   // the rush of way
    engNodes.muffle.frequency.setTargetAtTime(muffleTarget, c, 0.5);               // ease the door-muffle as you move room to room
  }
  if (engGain < 0.004 && target <= 0.002) { engTeardown(); clearInterval(engTimer); engTimer = null; }
}
function engEnsureTimer() { if (engTimer) return; lastT = performance.now(); engTimer = setInterval(engTick, 120); }

// ── Public API ───────────────────────────────────────────────────────────────
let kind = null;   // 'naval' | 'engine' | null
export function setYachtAmbience(next) {
  next = next === 'naval' || next === 'engine' ? next : null;
  muffleTarget = muffleFor(next);   // the door-muffle follows the room even when `kind` is otherwise unchanged
  if (next === kind) { if (engNodes) engEnsureTimer(); return; }   // only tick if the engine is actually live (avoid churn on every city move)
  if (kind === 'naval') stopHarbor();
  kind = next;
  if (kind === 'naval') startHarbor();
  // Steady idle bed: full in the engine room, and now carried right up to the open decks so she
  // plainly throbs underfoot at the top deck too (not just when under way). Interior cabins/city
  // zones (null) stay silent and lean on the passage roar.
  engFloor = kind === 'engine' ? 0.72 : kind === 'naval' ? 0.5 : 0;
  engEnsureTimer();
}

// `yacht_underway` — a passage began. Roar to life at this zone's loudness (server-scaled: ~1.0
// engine room, ~0.22 suite) and hold for the whole passage; the envelope quiets it on arrival.
export function yachtUnderway(level, durationMs) {
  roarLevel = 0.14 + (level == null ? 0.55 : level) * 0.9;
  roarUntil = performance.now() + (durationMs || 90000);
  engEnsureTimer();
}
// `yacht_settled` — she's arrived; let the roar fall away to quiet.
export function yachtSettled() { roarUntil = 0; engEnsureTimer(); }
