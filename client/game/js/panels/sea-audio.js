// SEA AUDIO — the sound of the water, derived from the wind the renderer already draws it from.
//
// Three things live here: a continuous SURF BED whose intensity is the sea state, discrete WAVE
// CRASHES whose rate is the whitecap coverage, and the HULL CREAK of a boat working in a seaway.
//
// ⚠ NOTHING HERE AUTHORS AN INTENSITY. `client/shared/sea-swell.js` already turns a wind speed into
// a sea, physically and in one place — wind knots -> significant wave height (JONSWAP, fetch-limited)
// -> wave amplitudes, plus Monahan's law for the fraction of the surface that is breaking. The GPU
// floor, the software raster and every hull afloat read that table. So does this file. The sea you
// HEAR and the sea you SEE cannot drift apart, because there is one table and no second copy of the
// curve — which is the same arrangement `sea-swell.js`'s own header sets out for the shader twin.
//
// ⚠ AND THE WIND IS ALREADY ON THE WIRE. `environment.js` carries `windKph` per zone, written by the
// same `weather.zoneAmbience` broadcast the rain FX and the precip bed read. No new field, no new
// server work, and a squall that reaches the overlay reaches the water in the same breath.
//
// ⚠ THE WIND ARRIVES AS A PROVIDER, NOT AS AN IMPORT. `startSea({ wind })` takes a function
// returning knots, and the caller is the one that knows where weather comes from. That is worth a
// line of plumbing for two reasons: importing `environment.js` would drag `state.js`, the settings
// module and the whole weather-FX canvas in behind it — so this file could not be loaded outside a
// browser, and the gate below could not run it at all — and because the sound of water is not a
// thing that should have to know what a HUD is. Absent a provider the sea is flat calm, which is
// the correct failure and an audible one.
//
// ⚠ THE BED BREATHES AT THE PERIOD THE SWELL IS DRAWN AT. `SEA_ROLL.w` is 0.18 rad/s — a 34.9 second
// roll — and `SEA_WIND.w` is 0.29, a 21.7 second wind sea. Those are the two trains a hull rides and
// the two you can watch going under the rail, so the bed's LFOs run at exactly those frequencies
// rather than at a chosen "oceany" rate. Standing on deck, the water you hear lifting is the water
// you can see lifting. An LFO at some other rate is the one thing here that would read as WRONG
// rather than merely as different, because both signals are in front of the player at once.
//
// ⚠ AND THE CREAK IS PHASE-LOCKED TO THAT SAME LFO, WHICH IS THE WHOLE POINT OF IT. A hull does not
// creak on a timer; it creaks when the swell loads it, twice a roll, at the extremes. The bed's roll
// LFO is started at a recorded `t0` and Web Audio oscillators start at phase zero, so the creak
// schedule is arithmetic off `t0` and lands where the bed is lifting. Fired from an independent
// random timer it would be a wooden noise in the vicinity of some waves; locked, she is working.

import { seaHsFor, whitecapFraction, stepSea, SEA_FULL_KT, SEA_ROLL, SEA_WIND } from '../../../shared/sea-swell.js';

const AE = () => globalThis.AudioEngine;

const rnd = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;
// ⚠ NaN-SAFE, AND THAT IS NOT PEDANTRY. Written as `Math.max(lo, Math.min(hi, v))` a NaN sails
// straight through, and every number in this file is on its way to an AudioParam — which rejects a
// non-finite value by THROWING, mid-cue, out of a scheduler tick. `NaN > lo` is false, so this form
// hands back the low bound instead: a silent sea rather than a dead one. A recording stub cannot
// find this (it has no contract to violate), so the gate's stub enforces the real rule as well.
const clamp = (v, lo, hi) => (v > lo ? (v < hi ? v : hi) : lo);
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const vary = (v, pct) => v * (1 + rnd(-pct, pct));

// The server reports wind in kph and every wave law in sea-swell.js is written in knots. One
// conversion, exported, because the two callers that need it are in different files.
export const KPH_TO_KT = 0.539957;

// The two trains, in Hz, off the same constants the shader displaces the mesh with. Written as a
// derivation and never as a literal: retuning the swell moves the picture, and a hand-copied 0.049
// here would leave the sound breathing at the sea the game used to have.
const ROLL_HZ = SEA_ROLL.w / (2 * Math.PI);   // ~0.0286 Hz — a 34.9 s ocean swell
const WIND_HZ = SEA_WIND.w / (2 * Math.PI);   // ~0.0462 Hz — a 21.7 s wind sea

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  HOW ROUGH IT IS
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// The renderer's own reservoir, run again on the audio side. It is deliberately a SECOND
// integration of the same law rather than a value plumbed over from windshield.js: that module is
// the flight sim, it only steps while a frame is being drawn, and a player standing on deck in a
// text room is not drawing frames. Both integrate `stepSea` off the same `windKph`, so they agree
// to within their own seeding, and neither can run without the other being open.
let SEA = { kt: 0, at: 0, seeded: false };
let seaForced = -1;      // >= 0 pins the wind in knots — the dev panel and the smoke gate
let windSource = null;   // () => knots, supplied by whoever started us

// What the sea is doing, right now, in the units everything downstream is a published function of.
export function seaNow() {
  const kt = seaForced >= 0 ? seaForced : SEA.kt;
  return {
    kt,
    hs: seaHsFor(kt),                          // significant wave height, METRES
    cap: whitecapFraction(kt),                 // fraction of surface breaking, 0..0.6
    state: clamp(kt / SEA_FULL_KT, 0, 1),      // 0 glass, 1 a strong gale
  };
}

// ⚠ IT SEEDS TO THE TARGET THE FIRST TIME IT IS ASKED. Walking out on deck ten minutes into a gale
// should start in a gale; only a gale that ARRIVES while you are standing there has to build.
function seaStep(nowMs) {
  let kt = 0;
  try { kt = Number(windSource?.()) || 0; } catch {}
  const target = Math.max(0, kt);
  if (!SEA.seeded) { SEA = { kt: target, at: nowMs, seeded: true }; return; }
  const dt = clamp((nowMs - SEA.at) * 0.001, 0, 30);
  SEA.at = nowMs;
  SEA.kt = stepSea(SEA.kt, target, dt);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  NODES
// ═══════════════════════════════════════════════════════════════════════════════════════════════

let ctx = null, bus = null, noiseBuf = null;
let out = null, verb = null, verbIn = null;
let live = [];         // every source started by a one-shot, so a stop can reach them

function ensureNodes() {
  if (ctx && bus) return true;
  const ae = AE(); if (!ae?.engineNodes) return false;
  ae.init?.();
  const eng = ae.engineNodes(); if (!eng?.ctx || !eng.bus) return false;
  ctx = eng.ctx; bus = eng.bus; noiseBuf = eng.noise;
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} }
  return true;
}

const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
const filt = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
function noiseLoop() { const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true; return n; }

function buildChain() {
  if (out) return;
  out = gain(0.9); out.connect(bus);
  // A short, dark reverb. Open water is nearly anechoic and a long tail on a surf bed reads as a
  // cave, so this exists for the crashes alone — hence the modest length and the low send.
  const secs = 1.5, len = Math.floor(ctx.sampleRate * secs);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.0);
  }
  verb = ctx.createConvolver(); verb.buffer = ir;
  const pre = filt('lowpass', 2400, 0.5);
  verbIn = gain(1);
  verbIn.connect(pre).connect(verb).connect(bus);
}

// A one-shot's output chain: gain -> pan -> (dry + verb send). Sources registered here are stopped
// on teardown, which is what stops a crash ringing on into a room you have already left.
function shot(pan, send, atSec, endSec) {
  const g = gain(1);
  const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
  g.connect(p); p.connect(out);
  if (send > 0) { const s = gain(send); p.connect(s).connect(verbIn); }
  const srcs = [];
  return {
    in: g,
    add(n) { srcs.push(n); return n; },
    go() {
      for (const s of srcs) { try { s.start(atSec); } catch {} try { s.stop(endSec + 0.1); } catch {} }
      live.push(...srcs);
      const ms = Math.max(200, (endSec - ctx.currentTime + 0.4) * 1000);
      setTimeout(() => {
        for (const s of srcs) { const i = live.indexOf(s); if (i >= 0) live.splice(i, 1); }
        try { g.disconnect(); p.disconnect(); } catch {}
      }, ms);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  1. THE SURF BED — three layers of filtered noise, breathing at the swell's own period
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// The layering is the established procedural-surf model: a low body that is always there, a mid
// band that swells and opens on each wave, and a bright hiss that only exists once the sea is
// actually breaking. What is ours is where the numbers come from — the LFO rates are the drawn
// swell (above), and the three gains are functions of the sea state rather than three faders.
//
// ⚠ IT DOES NOT GO THROUGH A STEALABLE VOICE. This is a bed; a voice budget that can take it away
// mid-gale would silence the sea to make room for a gull.

let bed = null;

function startBed() {
  if (bed) return;
  const t = ctx.currentTime;

  // BODY — the weight of water under everything. Lowpassed hard; this is the layer you feel.
  const bodyN = noiseLoop(), bodyLP = filt('lowpass', 200, 0.4), bodyG = gain(0);
  bodyN.connect(bodyLP).connect(bodyG).connect(out);

  // SWELL — the wave itself arriving and passing. Gain AND cutoff are swept by the roll LFO, which
  // is what turns a static wash into something that comes and goes.
  const swN = noiseLoop(), swBP = filt('bandpass', 520, 0.55), swG = gain(0);
  swN.connect(swBP).connect(swG).connect(out);
  const swSend = gain(0.18); swG.connect(swSend).connect(verbIn);

  // CREST — the hiss off a breaking top. Gated by the whitecap fraction, so a calm has none at all
  // and this layer is literally silent rather than quietly present.
  const crN = noiseLoop(), crHP = filt('highpass', 2600, 0.6), crG = gain(0);
  crN.connect(crHP).connect(crG).connect(out);

  // The two trains. Both start now, so `t0` is their common phase origin and the creak can be
  // scheduled against it.
  const rollL = osc('sine', ROLL_HZ);
  const windL = osc('triangle', WIND_HZ);
  // Depths are set in applyBed — they scale with the sea like everything else. A connected signal
  // ADDS to whatever the param is scheduled at, which is how the base level and the breath sum.
  const rollAM = gain(0), rollFM = gain(0), windAM = gain(0), crAM = gain(0);
  rollL.connect(rollAM).connect(swG.gain);
  rollL.connect(rollFM).connect(swBP.frequency);
  windL.connect(windAM).connect(swG.gain);
  rollL.connect(crAM).connect(crG.gain);

  for (const n of [bodyN, swN, crN, rollL, windL]) n.start(t);
  bed = { t0: t, bodyN, bodyLP, bodyG, swN, swBP, swG, crN, crHP, crG, rollL, windL, rollAM, rollFM, windAM, crAM };
  applyBed(true);
}

// Every level and cutoff in the bed, as a function of the sea. Called on the tick; a change of
// weather walks the bed across rather than switching it.
function applyBed(immediate = false) {
  if (!bed) return;
  const s = seaNow();
  const t = ctx.currentTime;
  const tc = immediate ? 0.05 : 3.0;     // the reservoir already has the inertia; this is just glue
  const set = (p, v) => { try { p.setTargetAtTime(v, t, tc); } catch {} };

  // A flat calm is not silent — there is always some water moving against a hull — but it is close
  // to it, and the whole range above it is the weather.
  const body = 0.010 + 0.085 * Math.pow(s.state, 0.75);
  const swell = 0.008 + 0.075 * Math.pow(s.state, 0.9);
  // The crest is the one layer keyed on the breaking fraction rather than the state, because that
  // is the physical question it answers: cap is ~0 below a fresh breeze and ~0.17 at a full gale.
  const crest = 0.55 * s.cap;

  set(bed.bodyG.gain, body);
  set(bed.swG.gain, swell);
  set(bed.crG.gain, crest);
  // A bigger sea is a BRIGHTER sea as well as a louder one — more of it is breaking and closer to
  // you. Scaling gain alone gives the same recording played up, which is the thing this whole file
  // exists not to do.
  set(bed.bodyLP.frequency, lerp(150, 430, s.state));
  set(bed.swBP.frequency, lerp(380, 1250, s.state));
  set(bed.crHP.frequency, lerp(3200, 2000, s.state));

  // Breath depths. The swell's AM is most of the level, so a wave genuinely arrives and passes.
  set(bed.rollAM.gain, swell * 0.75);
  set(bed.rollFM.gain, lerp(180, 700, s.state));
  set(bed.windAM.gain, swell * 0.35 * s.state);   // the short sea only shows up in a blow
  set(bed.crAM.gain, crest * 0.8);
}

function stopBed() {
  if (!bed) return;
  const b = bed; bed = null;
  const t = ctx.currentTime;
  for (const g of [b.bodyG, b.swG, b.crG]) { try { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.4); } catch {} }
  setTimeout(() => { for (const n of [b.bodyN, b.swN, b.crN, b.rollL, b.windL]) { try { n.stop(); } catch {} } }, 1400);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  2. BUBBLES — the foam, as physics rather than as a hiss
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// A bubble entrained in water rings at its Minnaert frequency, f = 3.26 / a with the radius in
// metres — so 3260 / a_mm. A 2 mm bubble is 1.6 kHz and an 8 mm one is 410 Hz, which is exactly the
// band a "plink" lives in, and it means the SIZE of the bubbles is the thing being chosen here
// rather than a pitch somebody liked. Big slow bubbles under a heavy break, fine fizz in a lap.
//
// ⚠ THE PITCH DRIFTS UP AS IT DIES, and that part is sound design rather than Minnaert: a bubble
// held at one frequency reads as a sine blip, and the rise is what makes an ear hear water. It is
// small (a few per cent) and it is the difference between foam and a test tone.
//
// ⚠ ONE VOICE, MANY BUBBLES. They are built INTO the crash's own chain, never as one shot each — a
// heavy break is forty of them and forty voices would be the entire budget for one wave.
function bubble(v, t0, aMm, peak, fm) {
  const f = 3260 / aMm;
  const C = osc('sine', f);
  const g = gain(0);
  C.connect(g).connect(v.in);
  v.add(C);
  // The onset chirp. A collapsing modulation index is what reads as STRUCK — the same shape the
  // hull knock and the bell in yacht-ambience.js use, an octave up and gone in a few milliseconds.
  if (fm) {
    const M = osc('sine', f * 2.05);
    const mg = gain(f * 1.3);
    mg.gain.setTargetAtTime(0, t0, 0.006);
    M.connect(mg).connect(C.frequency);
    v.add(M);
  }
  const tc = vary(0.010 + 0.022 * (aMm / 8), 0.3);   // bigger bubbles ring longer
  g.gain.setValueAtTime(peak, t0);
  g.gain.setTargetAtTime(0, t0, tc);
  C.frequency.setValueAtTime(f, t0);
  C.frequency.setTargetAtTime(f * rnd(1.02, 1.09), t0, tc * 1.6);
  return t0 + tc * 5;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  3. WAVE CRASH — build, break, foam
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// The three parts are the three things a breaker actually does, in order: the mass of water comes
// up (low, broadening), the face collapses (a bright noise burst whose band sweeps DOWN as the
// spectrum drops into the body of it), and then it is foam for as long again (hiss, plus the
// bubbles above).
//
// ⚠ `power` CHANGES THE SOUND, NOT THE FADER. Duration, band, the presence of a low thump at all,
// and the number of bubbles all move with it. A quiet crash and a loud one are different events —
// scaling one by gain gives a distant big wave, which is not what a small wave sounds like.
// ⚠ AND THERE IS A CEILING ON HOW MANY CAN BE RINGING AT ONCE. A heavy break is ~30 oscillators
// and four noise sources; the rate below is a physical one and a rate has no opinion about how long
// the last one lasts, so a gale with a gust in it can ask for the next before the previous two have
// finished. Three is about the point where a fourth adds nothing an ear can separate anyway, and
// the crest layer of the bed is already carrying "all of it is breaking" continuously.
//
// ⚠ IT IS A LIST OF END TIMES ON THE AUDIO CLOCK, NEVER A COUNTER RELEASED BY A TIMER. A counter
// decremented from `setTimeout` is only correct while timers fire on schedule, and a backgrounded
// tab throttles them to once a minute or stops them outright — so the count sticks at the ceiling
// and the sea never breaks again for the rest of the session, silently, with the bed still running
// so nothing sounds obviously broken. `ctx.currentTime` is the clock the sounds themselves are
// scheduled on and cannot drift away from them.
let crashEnds = [];

export function waveCrash(power = 0.5, pan = null) {
  if (!out) return 0;
  crashEnds = crashEnds.filter((e) => e > ctx.currentTime);
  if (crashEnds.length >= 3) return 0;
  const p = clamp(power, 0, 1);
  const t = ctx.currentTime + 0.02;
  const dur = lerp(0.75, 2.6, p);
  const v = shot(pan == null ? rnd(-0.8, 0.8) : pan, lerp(0.15, 0.45, p), t, t + dur * 1.8);

  // THE BUILD — a short rising rumble. Only a real sea has one; a slop against a quay is all break.
  if (p > 0.25) {
    const n = noiseLoop(), lp = filt('lowpass', 160, 0.7), g = gain(0);
    n.connect(lp).connect(g).connect(v.in); v.add(n);
    const build = dur * 0.35;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.10 * p, t + build);
    g.gain.setTargetAtTime(0, t + build, 0.25);
    lp.frequency.setValueAtTime(140, t);
    lp.frequency.linearRampToValueAtTime(lerp(300, 620, p), t + build);
  }

  const tb = t + (p > 0.25 ? dur * 0.3 : 0);   // the break lands at the top of the build

  // THE BREAK — the burst. The downward band sweep is the collapse; swept upward it reads as a
  // splash going in rather than as a face falling over.
  {
    const n = noiseLoop(), bp = filt('bandpass', 1200, 0.7), g = gain(0);
    n.connect(bp).connect(g).connect(v.in); v.add(n);
    bp.frequency.setValueAtTime(lerp(950, 2300, p), tb);
    bp.frequency.exponentialRampToValueAtTime(lerp(300, 420, p), tb + dur * 0.5);
    bp.Q.setValueAtTime(0.7, tb);
    g.gain.setValueAtTime(0, tb);
    g.gain.linearRampToValueAtTime(lerp(0.09, 0.30, p), tb + 0.03 + 0.05 * p);
    g.gain.setTargetAtTime(0, tb + 0.05, dur * 0.20);
  }

  // The thump of the mass landing. A sine an ear reads as weight rather than as a note, and only
  // on a sea big enough to have any.
  if (p > 0.4) {
    const o = osc('sine', lerp(74, 44, p)), g = gain(0);
    o.connect(g).connect(v.in); v.add(o);
    o.frequency.setTargetAtTime(lerp(52, 30, p), tb, 0.18);
    g.gain.setValueAtTime(0.16 * p, tb);
    g.gain.setTargetAtTime(0, tb, 0.13);
  }

  // THE FOAM — hiss for as long again, and the bubbles inside it.
  {
    const n = noiseLoop(), hp = filt('highpass', 1800, 0.5), g = gain(0);
    n.connect(hp).connect(g).connect(v.in); v.add(n);
    const tf = tb + dur * 0.12;
    g.gain.setValueAtTime(0, tf);
    g.gain.linearRampToValueAtTime(lerp(0.04, 0.13, p), tf + dur * 0.15);
    g.gain.setTargetAtTime(0, tf + dur * 0.2, dur * 0.42);
    hp.frequency.setValueAtTime(lerp(2600, 1500, p), tf);
    hp.frequency.setTargetAtTime(lerp(4200, 2800, p), tf, dur * 0.5);
  }
  const nB = Math.round(lerp(4, 26, p));
  for (let i = 0; i < nB; i++) {
    // Bigger seas throw bigger bubbles, and the deep ones arrive late — the fizz is on top of the
    // break and the plunks are down in the foam behind it.
    const aMm = vary(lerp(1.6, 7.0, p * Math.random()), 0.35);
    const at = tb + dur * rnd(0.05, 0.9);
    bubble(v, at, clamp(aMm, 0.8, 9), vary(lerp(0.02, 0.05, p), 0.4), aMm > 4);
  }
  crashEnds.push(t + dur * 1.8);
  v.go();
  return dur;
}

// A LAP — the small water a hull or a quay wall always has against it, whatever the weather. The
// crash's own shape at the bottom of its range would be a wasted six nodes, so this is its own
// much cheaper thing: one short noise chip and two or three bubbles.
export function lap(power = 0.2) {
  if (!out) return;
  const p = clamp(power, 0, 1);
  const t = ctx.currentTime + 0.01;
  const v = shot(rnd(-1, 1), 0.12, t, t + 0.5);
  const n = noiseLoop(), bp = filt('bandpass', lerp(700, 380, p), 1.1), g = gain(0);
  n.connect(bp).connect(g).connect(v.in); v.add(n);
  const peak = vary(lerp(0.020, 0.055, p), 0.3);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.008);
  g.gain.setTargetAtTime(0, t + 0.008, lerp(0.03, 0.07, p));
  bp.frequency.setTargetAtTime(lerp(420, 240, p), t, 0.05);
  const nB = 1 + Math.floor(Math.random() * (1 + Math.round(p * 3)));
  for (let i = 0; i < nB; i++) bubble(v, t + rnd(0.005, 0.12), vary(lerp(1.4, 4.0, p), 0.4), vary(0.022, 0.4), false);
  v.go();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  4. HULL CREAK — stick-slip, as FM
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ A CREAK IS NOT A TONE WITH VIBRATO ON IT, and that is the whole reason this is not just the
// dock creak with a different number. Two surfaces under load do not slide, they STICK and SLIP:
// the timber grabs, strains, releases, grabs again, hundreds of times a second, and what an ear
// hears is that train of micro-releases. The pitch of a creak IS the slip rate. So the defining
// part of this patch is not the carrier — it is an amplitude modulator whose RATE sweeps up and
// back down across the event, which is the "rrrREEE-ah" of something taking a load and giving it
// up. A carrier with an LFO on its pitch instead gives a moan, which is what a boat does not do.
//
// The FM does the timbre: a modulator at a NON-INTEGER ratio puts inharmonic partials in it, which
// is what makes it wood under strain rather than a reed. Index falls as the load comes off.
//
// `load` 0..1 — how hard she is being worked. Below about 0.25 this is a single tired settle; at
// the top it is a long complaining one with a squeal in it.
export function hullCreak(load = 0.4) {
  if (!out) return;
  const L = clamp(load, 0, 1);
  const t = ctx.currentTime + 0.01;
  const dur = vary(lerp(0.45, 1.9, L), 0.25);
  const f0 = vary(lerp(210, 96, L), 0.12);         // a bigger load speaks lower — a heavier member
  const v = shot(rnd(-0.7, 0.7), 0.22, t, t + dur + 0.6);

  const C = osc('triangle', f0);
  const cg = gain(0);
  C.connect(cg).connect(v.in); v.add(C);

  // The inharmonic body. 2.41 is deliberately not a whole number: at a whole ratio the partials
  // land on the harmonic series and it reads as an instrument.
  const M = osc('sine', f0 * 2.41);
  const mg = gain(f0 * lerp(1.4, 4.2, L));
  M.connect(mg).connect(C.frequency); v.add(M);
  mg.gain.setValueAtTime(f0 * lerp(1.4, 4.2, L), t);
  mg.gain.setTargetAtTime(f0 * 0.35, t + dur * 0.4, dur * 0.35);

  // THE SLIP TRAIN. A sawtooth is the right shape for it — a slip is a fast release and a slow
  // reload, not a sine — and its frequency is swept up through the middle of the event and back.
  const slip = osc('sawtooth', lerp(11, 26, L));
  const slipD = gain(0);
  slip.connect(slipD).connect(cg.gain); v.add(slip);
  const hi = lerp(34, 95, L) * vary(1, 0.2);
  slip.frequency.setValueAtTime(lerp(11, 26, L), t);
  slip.frequency.linearRampToValueAtTime(hi, t + dur * 0.45);
  slip.frequency.linearRampToValueAtTime(lerp(9, 18, L), t + dur);

  // Envelope. Slow in, because a load comes ON gradually; the release is the thing letting go.
  const peak = vary(lerp(0.055, 0.16, L), 0.2);
  cg.gain.setValueAtTime(0, t);
  cg.gain.linearRampToValueAtTime(peak, t + dur * 0.35);
  cg.gain.setValueAtTime(peak, t + dur * 0.75);
  cg.gain.linearRampToValueAtTime(0, t + dur);
  // The AM rides at roughly half the envelope, so the train is deep enough to be the sound rather
  // than a wobble on it, and never so deep that it gates itself into clicks.
  slipD.gain.setValueAtTime(0, t);
  slipD.gain.linearRampToValueAtTime(peak * 0.55, t + dur * 0.35);
  slipD.gain.linearRampToValueAtTime(0, t + dur);

  // The strain: pitch rises a little as the load comes on, the way a stressed member does.
  C.frequency.setValueAtTime(f0, t);
  C.frequency.setTargetAtTime(f0 * lerp(1.06, 1.22, L), t, dur * 0.5);
  // and jitters, because no two slips release at the same point.
  const steps = 4 + Math.round(L * 5);
  for (let k = 1; k <= steps; k++) C.detune.setValueAtTime(rnd(-45, 45) * L, t + dur * (k / (steps + 1)));

  // A squeal on top, only when she is really working: a high carrier at a low index, which is the
  // narrow whistle a hard-loaded fastening gives off.
  if (L > 0.55) {
    const S = osc('sine', f0 * vary(9.5, 0.1)), sm = osc('sine', f0 * 4.7);
    const sg = gain(0), smg = gain(f0 * 0.8);
    sm.connect(smg).connect(S.frequency);
    S.connect(sg).connect(v.in); v.add(S); v.add(sm);
    const sp = vary(0.02 * (L - 0.55) / 0.45, 0.3);
    sg.gain.setValueAtTime(0, t + dur * 0.25);
    sg.gain.linearRampToValueAtTime(sp, t + dur * 0.5);
    sg.gain.linearRampToValueAtTime(0, t + dur * 0.9);
  }
  v.go();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  THE CLOCK
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// One timer. It steps the reservoir, walks the bed to it, and schedules the discrete events — and
// the events are scheduled off the BED's phase origin rather than off a free-running random timer,
// so what you hear breaking and what you hear working are the same wave.

let timer = null, nextLap = 0, nextCrash = 0, nextCreak = 0;

// Where in the roll the bed is, 0..1, with 0.25 the crest. `bed.t0` is when the roll LFO started
// and a Web Audio oscillator starts at phase zero, so this is exactly what the bed is doing.
function rollPhase() {
  if (!bed) return 0;
  return ((ctx.currentTime - bed.t0) * ROLL_HZ) % 1;
}

function tick() {
  const nowMs = performance.now();
  seaStep(nowMs);
  applyBed();
  if (!bed) return;
  const s = seaNow();
  const now = ctx.currentTime;
  const ph = rollPhase();

  // LAPS — always, and faster in a sea. The crest of the roll is when the water is actually at the
  // hull, so they cluster there rather than being spread flat across the cycle.
  if (now >= nextLap) {
    lap(lerp(0.12, 0.7, s.state));
    const base = lerp(2.6, 0.55, s.state);
    // twice as often through the top half of the roll
    nextLap = now + base * rnd(0.5, 1.5) * (ph > 0.1 && ph < 0.45 ? 0.5 : 1);
  }

  // CRASHES — rate straight off Monahan. `cap` is ~0.001 in a light breeze and ~0.17 in a full
  // gale, which is one every few minutes against one every few seconds, and that spread IS the
  // weather. Nothing breaks at all in a calm, which is correct and is why there is no floor here.
  if (s.cap > 0.0015 && now >= nextCrash) {
    // A breaker arrives on the crest. Scheduling one anywhere in the cycle is a wave with no swell
    // under it, which is audible the moment there is a bed to hear it against.
    waveCrash(clamp(0.25 + s.state * 0.85, 0, 1) * rnd(0.75, 1.15));
    // ⚠ THE CEILING IS NOT A FUDGE — IT IS WHERE THE BED TAKES OVER. `cap` goes as the cube-and-a-bit
    // of wind speed, so a rate straight off it spans 150:1 and asks for a breaker every 3.9 s at the
    // top, which stops being individual waves and becomes mush. Past about a five-second spacing the
    // thing that actually carries "all of it is breaking" is the crest layer of the bed, which is
    // keyed on the same `cap` and rises continuously — so the discrete events are floored and the
    // continuous one goes on climbing. Two ways of saying the same number, each doing the half of it
    // it is good at.
    const per = clamp(55 / (s.cap * 60), 5, 300);     // seconds between breakers
    nextCrash = now + per * rnd(0.6, 1.4);
  }

  // CREAK — twice a roll, at the extremes, where the swell has her over furthest and the load on
  // the fastenings peaks. She works harder in a big sea and barely at all alongside in a calm.
  if (now >= nextCreak) {
    const half = 1 / (ROLL_HZ * 2);                    // ~10.1 s
    if (s.state > 0.04 || chance(0.25)) hullCreak(clamp(0.15 + s.state * 0.9, 0, 1) * rnd(0.8, 1.15));
    // Locked to the half-roll, with enough jitter that it is a boat and not a metronome.
    nextCreak = now + half * rnd(0.85, 1.15) * (s.state > 0.25 ? 1 : rnd(1.5, 3.5));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════════════════════

let running = false;

// `wind` is a function returning the live wind in KNOTS. See the header: this module does not know
// where weather comes from, and a missing provider is a flat calm rather than a crash.
export function startSea({ wind } = {}) {
  if (wind) windSource = wind;
  if (running) return true;
  gen++;                        // invalidates any teardown still pending from a recent stopSea
  if (!ensureNodes()) return false;
  buildChain();
  if (!out) return false;
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setValueAtTime(0.9, ctx.currentTime);
  startBed();
  running = true;
  nextLap = nextCrash = nextCreak = ctx.currentTime + 1.5;
  if (!timer) timer = setInterval(tick, 250);
  return true;
}

// ⚠ THE TEARDOWN IS GENERATION-CHECKED, BECAUSE IT RUNS 1.6 SECONDS LATE AND A PLAYER IS FASTER.
// The tail has to ring out before the chain can be disconnected, so the cleanup is on a timer — and
// stepping off the deck and back on inside that window restarts the sea onto the SAME `out` (the
// chain is still there, so `buildChain` skips) and then the old timer fires and disconnects it. The
// result is a running scheduler, a rebuilt bed, and no path to the bus: silence for the rest of the
// session, with `isSeaRunning()` cheerfully true and nothing in any log. The counter is bumped by
// every start and every stop, and the closure only cleans up the generation it was scheduled for.
let gen = 0;

export function stopSea() {
  if (!running) return;
  running = false;
  if (timer) { clearInterval(timer); timer = null; }
  crashEnds = [];
  stopBed();
  if (out) {
    const t = ctx.currentTime;
    try { out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, 0.4); } catch {}
  }
  const mine = ++gen;
  setTimeout(() => {
    if (mine !== gen) return;         // a start overtook us — this chain is in use again
    for (const s of live) { try { s.stop(); } catch {} }
    live = [];
    try { out?.disconnect(); verb?.disconnect(); verbIn?.disconnect(); } catch {}
    out = verb = verbIn = null;
  }, 1600);
}

export function isSeaRunning() { return running; }

// Pin the wind, in knots — the dev panel's sea-state slider and the smoke gate. -1 hands it back to
// the weather. This is the audio twin of RENDER_TUNE.glSeaState and it takes the same units.
export function setSeaWindOverride(kt) { seaForced = kt == null ? -1 : kt; }

// For the gate and the dev panel: everything the sea is doing, in one object.
export function seaAudioState() {
  const s = seaNow();
  return { ...s, running, bed: !!bed, forced: seaForced, rollHz: ROLL_HZ, windHz: WIND_HZ };
}

// The test seam. Nothing in the game calls this; the smoke gate drives the scheduler a step at a
// time so it can assert what was SCHEDULED without waiting out a 20-second swell in real time.
export const _test = {
  tick, rollPhase,
  bedNodes: () => bed,
  chain: () => ({ out, verb, verbIn }),
  // Re-seed the reservoir so a gate can put the sea at a wind without waiting out SEA_RISE_S.
  seed(kt) { SEA = { kt, at: performance.now(), seeded: true }; },
  setWind(fn) { windSource = fn; },
};
