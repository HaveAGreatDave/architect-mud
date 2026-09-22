// MURMURATION AUDIO — the sound a starling cloud makes, generated rather than sampled.
//
// The visual murmuration has been up since the fauna pass (murmur.js, and the songbird row in
// client/shared/birds.js): four hundred to seventeen hundred birds milling over a roost. What it
// SOUNDED like was one starling's call every seventy seconds, because a murmuration was being
// voiced by the same per-flock burst schedule that voices a pair of geese. A thousand birds and
// one chirp.
//
// ⚠ A FLOCK IS NOT A LOUDER BIRD, WHICH IS THE WHOLE REASON THIS IS A SEPARATE FILE.
// procedural-sfx.js builds ONE CALL from one throat — a formant bank driven hard, which is the
// right thing for an event you notice. Scaling that to a thousand birds gives a thousand copies
// of one throat, and that is a chorus rather than a flock: what makes a murmuration recognisable
// is that no two voices line up, and that under all of them sits the MURMUR the word is named
// after, which is wings and not voices at all. So this is a BED — continuous, generative, never
// the same twice — and it lives beside the other live ambience rather than in the one-shot
// catalogue.
//
// ⚠ AND IT OWNS THE FLOCK'S VOICE WHILE IT RUNS. windshield.js skips the ordinary call burst for
// a flock this bed is covering, because a discrete starling cry on top of a starling cloud is the
// same animal heard twice at two scales.
//
// The seam is `engineNodes()` — the ctx, the ambient bus and the shared noise buffer — the one
// the flight engine and yacht-ambience.js already build on. Nothing here is a sample and nothing
// here is a fixed sequence: every event's pitch, index, duration, envelope, pan, level and timing
// is rolled, and the density under them breathes on a slow random walk, so there's no loop point
// to hear.
//
// LAYERS, loudest first:
//   calls     short FM chirps, 15-30 a second, overlapping, each with a pitch contour
//   wings     the murmur: band-passed noise amplitude-modulated around the wingbeat rate
//   flutters  individual wingbursts, close and scattered across the stereo field
//   body      a very quiet low-mid FM pad, so the flock has a size instead of being all whistles
//
// ⚠ NO STROBE AND NO CLEAN TREMOLO. The wing AM sits at 12-15 Hz, which is in the roughness band
// where a PERFECTLY regular modulation stops reading as an animal and starts reading as an
// effect — the same trap the bird voices' vibrato-rate note records. Its rate drifts continuously
// between five values, which is what turns a pulse into a "fffrrrrr".

const AE = () => window.AudioEngine;

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const chance = (p) => Math.random() < p;
const vary = (v, pct) => v * (1 + rnd(-pct, pct));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const db = (d) => Math.pow(10, d / 20);          // decibels to a linear gain

// ── TUNING ───────────────────────────────────────────────────────────────────
//
// Everything a person would reach for lives here. The mix is stated in dB against the calls,
// because that's how the brief for this reads and because a table of raw gains can't be argued
// with — you can't tell by eye that 0.018 is eighteen down.
const T = {
  callRate: [15, 30],        // events/sec at full density — the band it sits in nearly always
  rateFloor: 8,              // events/sec at minimum density
  maxVoices: 26,             // concurrent chirps; a dropped chirp in a cloud isn't perceivable
  density: { min: 0.25, max: 1, period: [4, 14] },
  wing: { band: [700, 1800], am: [12, 15], depth: [0.20, 0.45], drift: 2.6 },
  flutter: { rate: [4, 12] },
  manoeuvre: { every: [5, 15], hold: [0.8, 2.5], back: [0.5, 1.5] },
  mix: { calls: 0, wings: -12, flutters: -18, body: -24, high: -10 },
  // The one number the caller moves. A bed at 1 is a flock overhead; the rest is distance.
  master: 0.55,
};

// The pitch contours. A chirp is a SHAPE, never a held note — an oscillator sitting on one
// frequency reads as an instrument however good the timbre is, which is the rule the bird voices
// already state and the reason none of these is flat. `w` is the relative chance of each.
const SHAPES = [
  { id: 'up',    w: 22, from: 1200, to: 3000, ms: 90 },
  { id: 'down',  w: 22, from: 3200, to: 1500, ms: 100 },
  { id: 'arch',  w: 20, from: 1400, peak: 4200, to: 2200, ms: 150 },
  { id: 'trill', w: 18, from: 2200, to: 2200, ms: 140, trill: { range: 500, rate: 22 } },
  // ⚠ THE TWO HIGH ONES ARE RARE ON PURPOSE. A starling's sharp phrases run up past 6 kHz and are
  // a real part of the animal, and at any ordinary share of the events the whole flock turns into
  // a smoke alarm. Together these are about a tenth of what you hear, which is where the brief
  // puts them, and both are quieter than the midrange calls.
  { id: 'high',  w: 12, from: 4200, to: 7000, ms: 80,  quiet: -4 },
  { id: 'sharp', w: 6,  from: 6200, to: 8600, ms: 70,  quiet: -6 },
];
const SHAPE_TOTAL = SHAPES.reduce((s, x) => s + x.w, 0);
function rollShape() {
  let r = Math.random() * SHAPE_TOTAL;
  for (const s of SHAPES) { r -= s.w; if (r <= 0) return s; }
  return SHAPES[0];
}

// How far away a given bird in the cloud is. Most of a flock isn't overhead, which is the
// difference between a murmuration and sixteen synthesisers standing beside you: the far ones are
// quieter AND duller, because air takes the top off before it takes the level off.
const DISTANCES = [
  { w: 62, gain: [-38, -32], lpf: [3500, 5000],  spread: 1.00 },
  { w: 30, gain: [-30, -24], lpf: [5000, 8000],  spread: 0.80 },
  { w: 8,  gain: [-22, -16], lpf: [8000, 12000], spread: 0.55 },   // foreground: ~8% of events
];
function rollDistance(foregroundBias) {
  // A manoeuvre brings birds past you, so it lifts the foreground SHARE rather than the volume.
  const w = DISTANCES.map((d, i) => d.w * (i === 2 ? 1 + foregroundBias : 1));
  let r = Math.random() * w.reduce((s, x) => s + x, 0);
  for (let i = 0; i < DISTANCES.length; i++) { r -= w[i]; if (r <= 0) return DISTANCES[i]; }
  return DISTANCES[0];
}

// ── GRAPH ────────────────────────────────────────────────────────────────────
let ctx = null, bus = null, noiseBuf = null;
let out = null, comp = null, tone = null;        // flock sum -> gentle compression -> air lowpass
let wing = null, body = null;                    // the two continuous layers
let live = 0;                                    // concurrent chirp voices

function ensureNodes() {
  if (ctx && bus) return true;
  const ae = AE(); if (!ae?.engineNodes) return false;
  ae.init?.();
  const eng = ae.engineNodes(); if (!eng?.ctx || !eng.bus) return false;
  ctx = eng.ctx; bus = eng.bus; noiseBuf = eng.noise;
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} }
  return !!noiseBuf;
}

// ⚠ GENTLE, AND THAT IS THE POINT OF HAVING ONE AT ALL. The density breathes by a factor of four
// and the manoeuvres push past that, so with no compressor the loud moments clip the bus and with
// a hard one the flock stops breathing — which is the single thing this bed is for. 2:1 with a
// slow knee holds the peaks and leaves the swell.
function buildChain() {
  out = ctx.createGain(); out.gain.value = 0;
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24; comp.ratio.value = 2; comp.knee.value = 12;
  comp.attack.value = 0.02; comp.release.value = 0.15;
  tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 11000; tone.Q.value = 0.5;
  out.connect(comp).connect(tone).connect(bus);
}

// ── THE WINGS ────────────────────────────────────────────────────────────────
//
// "Murmuration" is the murmur of the wingbeats, so this layer is the subject rather than the
// backing. One shared noise source feeds two band-passed paths panned apart, each with its own
// amplitude modulator: two rates a little apart beat against each other, which is what stops the
// result being an audible pulse. Their centres differ too, so the flock has a width before any
// bird has been placed in it.
function buildWing() {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const level = ctx.createGain(); level.gain.value = db(T.mix.wings);
  level.connect(out);
  const sides = [];
  for (const side of [-1, 1]) {
    const depthAmt = rnd(T.wing.depth[0], T.wing.depth[1]) / 2;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rnd(T.wing.band[0], T.wing.band[1]);
    bp.Q.value = 0.9;                                 // a bandwidth of rather more than an octave
    const am = ctx.createGain(); am.gain.value = 1 - depthAmt;
    const lfo = ctx.createOscillator(); lfo.type = 'sine';
    lfo.frequency.value = rnd(T.wing.am[0], T.wing.am[1]);
    const depth = ctx.createGain(); depth.gain.value = depthAmt;
    lfo.connect(depth).connect(am.gain);
    const pan = ctx.createStereoPanner(); pan.pan.value = side * 0.55;
    src.connect(bp).connect(am).connect(pan).connect(level);
    lfo.start();
    sides.push({ bp, lfo, pan, am });
  }
  src.start();
  wing = { src, level, sides };
}

// ⚠ THE RATE IS RE-AIMED, NEVER STEPPED. Five values with a smooth glide between them is the
// brief, and `setTargetAtTime` is exactly that curve — jump it and you hear the flock change gear.
function wingDrift() {
  if (!wing) return;
  const t = ctx.currentTime;
  for (const s of wing.sides) {
    const r = pick([12.0, 12.7, 13.4, 14.1, 15.0]) * vary(1, 0.03);
    s.lfo.frequency.setTargetAtTime(r, t, T.wing.drift);
    s.bp.frequency.setTargetAtTime(rnd(T.wing.band[0], T.wing.band[1]), t, T.wing.drift * 1.5);
    // The flock is physically large and it moves. The two sides drift apart and back rather than
    // sweeping together, so the width changes without the whole cloud sliding left and right.
    s.pan.pan.setTargetAtTime(clamp(s.pan.pan.value + rnd(-0.18, 0.18), -0.95, 0.95), t, 2.0);
  }
}

// ── THE BODY ─────────────────────────────────────────────────────────────────
//
// Almost subliminal, and the difference between a flock and a swarm of whistles. Two low-index FM
// pairs in the 700-1500 band, detuned and slowly drifting, so the whistles have something to sit
// on top of.
function buildBody() {
  const level = ctx.createGain(); level.gain.value = db(T.mix.body);
  level.connect(out);
  const parts = [];
  for (const side of [-0.4, 0.4]) {
    const f = rnd(700, 1500);
    const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * rnd(1.4, 2.2);
    const idx = ctx.createGain(); idx.gain.value = f * rnd(1.0, 2.5) / 2;
    mod.connect(idx).connect(car.frequency);
    const pan = ctx.createStereoPanner(); pan.pan.value = side;
    const g = ctx.createGain(); g.gain.value = 0.5;
    car.connect(g).connect(pan).connect(level);
    car.start(); mod.start();
    parts.push({ car, mod, idx });
  }
  body = { level, parts };
}
function bodyDrift() {
  if (!body) return;
  const t = ctx.currentTime;
  for (const p of body.parts) {
    const f = rnd(700, 1500);
    p.car.frequency.setTargetAtTime(f, t, 4);
    p.mod.frequency.setTargetAtTime(f * rnd(1.4, 2.2), t, 4);
    p.idx.gain.setTargetAtTime(f * rnd(1.0, 2.5) / 2, t, 4);
  }
}

// ── ONE CHIRP ────────────────────────────────────────────────────────────────
//
// Carrier and modulator are both sines, and the character is entirely in the two envelopes. The
// pitch falls, rises or arches over the length of the call, and the modulation INDEX moves with
// it — up hard at the front and collapsing by the end. A static index is the static electronic
// whistle this is written to avoid, and it's the same observation the instrument voices make
// about a struck string.
function chirp(t0, opts) {
  if (live >= T.maxVoices) return;
  const sh = rollShape();
  const d = opts.dist;
  const k = vary(1, 0.20);                             // the ±15-25% roll the shape table wants
  const dur = clamp(sh.ms * k, 45, 260) / 1000;
  const from = sh.from * vary(1, 0.06), to = sh.to * vary(1, 0.06);
  const peak = sh.peak ? sh.peak * vary(1, 0.06) : null;
  const rel = rnd(0.015, 0.070);
  const tEnd = t0 + dur + rel;

  const car = ctx.createOscillator(); car.type = 'sine';
  const mod = ctx.createOscillator(); mod.type = 'sine';
  const ratio = rnd(1.5, 3.5);
  const idx = ctx.createGain();
  mod.connect(idx).connect(car.frequency);

  const amp = ctx.createGain(); amp.gain.value = 0;
  const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass';
  lpf.frequency.value = rnd(d.lpf[0], d.lpf[1]);
  lpf.Q.value = 0.4;
  const pan = ctx.createStereoPanner();
  // ⚠ A BIRD'S POSITION MOVES, IT DOESN'T JUMP. The pan ramps across the call and the whole field
  // is offset by the flock's own drift, so the cloud has a place as well as a width.
  const p0 = clamp(opts.centre + rnd(-1, 1) * opts.spread * d.spread, -1, 1);
  pan.pan.setValueAtTime(p0, t0);
  pan.pan.linearRampToValueAtTime(clamp(p0 + rnd(-0.12, 0.12), -1, 1), tEnd);
  car.connect(amp).connect(lpf).connect(pan).connect(out);

  // Pitch. A trill is the one contour that isn't a ramp — it's a centre with an LFO on it, and it
  // needs its own oscillator rather than a stack of ramps.
  let trillOsc = null;
  car.frequency.setValueAtTime(from, t0);
  if (sh.trill) {
    trillOsc = ctx.createOscillator(); trillOsc.type = 'sine';
    trillOsc.frequency.value = vary(sh.trill.rate, 0.2);
    const tg = ctx.createGain(); tg.gain.value = vary(sh.trill.range, 0.2);
    trillOsc.connect(tg).connect(car.frequency);
    trillOsc.start(t0); trillOsc.stop(tEnd + 0.05);
  } else if (peak) {
    car.frequency.exponentialRampToValueAtTime(peak, t0 + dur * 0.42);
    car.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  } else {
    car.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  }
  // ⚠ 2-5% INSTABILITY, AND IT ISN'T DECORATION. A bird is blowing air through a tube that's
  // changing shape; a perfectly tracked pitch is the tell that it isn't.
  car.detune.setValueAtTime(rnd(-35, 35), t0);
  car.detune.linearRampToValueAtTime(rnd(-60, 60), tEnd);

  // The modulator tracks the carrier, so the timbre holds together through the sweep.
  mod.frequency.setValueAtTime(from * ratio, t0);
  if (!sh.trill) mod.frequency.exponentialRampToValueAtTime((peak || to) * ratio, t0 + dur * (peak ? 0.42 : 1));

  // The index envelope: in hard, then away. Expressed against the carrier, because an FM index is
  // a ratio and the gain node wants hertz.
  const i0 = rnd(1.5, 3.0), i1 = rnd(3.0, 8.0) * (opts.bright ? 1.15 : 1), i2 = rnd(1.2, 2.5);
  idx.gain.setValueAtTime(from * i0, t0);
  idx.gain.linearRampToValueAtTime(from * i1, t0 + Math.min(0.03, dur * 0.3));
  idx.gain.linearRampToValueAtTime(from * i2, t0 + dur);
  idx.gain.linearRampToValueAtTime(from * 0.6, tEnd);

  // ADSR, plus the distance band's own level and the high calls' penalty.
  const a = rnd(0.003, 0.012), dec = rnd(0.020, 0.080), sus = rnd(0.15, 0.55);
  const high = sh.id === 'high' || sh.id === 'sharp';
  const g = db(rnd(d.gain[0], d.gain[1]) + (sh.quiet || 0) + (high ? T.mix.high : T.mix.calls));
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(g, t0 + a);
  amp.gain.linearRampToValueAtTime(g * sus, t0 + a + dec);
  amp.gain.setTargetAtTime(0, t0 + dur, rel / 3);

  car.start(t0); mod.start(t0);
  car.stop(tEnd + 0.05); mod.stop(tEnd + 0.05);
  live++;
  const ms = Math.max(120, (tEnd - ctx.currentTime + 0.3) * 1000);
  setTimeout(() => {
    live--;
    try { car.disconnect(); mod.disconnect(); idx.disconnect(); amp.disconnect(); lpf.disconnect(); pan.disconnect(); } catch {}
    if (trillOsc) { try { trillOsc.disconnect(); } catch {} }
  }, ms);
}

// ── ONE WINGBURST ────────────────────────────────────────────────────────────
// A bird close enough that you hear its actual wings rather than the flock's. Short, noisy, and
// scattered right across the field — these are what give the cloud depth.
function flutter(t0) {
  const dur = rnd(0.020, 0.070), rel = rnd(0.010, 0.040);
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.setValueAtTime(rnd(800, 3000), t0);
  bp.frequency.exponentialRampToValueAtTime(rnd(700, 1600), t0 + dur + rel);
  bp.Q.value = rnd(0.8, 1.6);
  const amp = ctx.createGain(); amp.gain.value = 0;
  const pan = ctx.createStereoPanner(); pan.pan.value = rnd(-1, 1);
  src.connect(bp).connect(amp).connect(pan).connect(out);
  const g = db(rnd(-32, -20) + T.mix.flutters);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(g, t0 + rnd(0.002, 0.005));
  amp.gain.setTargetAtTime(0, t0 + dur, rel / 3);
  src.start(t0); src.stop(t0 + dur + rel + 0.05);
  setTimeout(() => { try { src.disconnect(); bp.disconnect(); amp.disconnect(); pan.disconnect(); } catch {} },
    Math.max(120, (t0 + dur + rel - ctx.currentTime + 0.3) * 1000));
}

// ── THE CLOCK ────────────────────────────────────────────────────────────────
//
// ⚠ LOOKAHEAD SCHEDULING, NOT A TIMER PER EVENT. At thirty events a second a setTimeout per chirp
// is thirty timers a second whose accuracy is whatever the main thread is doing, and the one thing
// this bed can't survive is its events landing on frame boundaries — that's audible as a pulse
// immediately. A single slow interval rolls the events for the next window and books them against
// the audio clock, which is sample-accurate and doesn't care about the frame.
const TICK_MS = 120, WINDOW = 0.28;              // schedule this far ahead, in seconds
let timer = null, booked = 0;                    // audio time everything is scheduled up to

// The density controller. A smoothed random walk rather than a sine, because a sine is a period
// you can hear and the flock is supposed to breathe rather than pulse.
const dens = { now: 0.6, to: 0.6, until: 0 };
// The manoeuvre. Every few seconds the flock changes direction: more birds, more wings, wider,
// and then back down. It isn't a transition and nothing about it resolves.
const man = { amt: 0, to: 0, until: 0, next: 0, back: 1 };
// The flock's own place in the field, which drifts slowly and never sweeps.
const field = { centre: 0, to: 0, spread: 0.7 };
let bedGain = 0, bedTarget = 0, sizeMix = 0;     // what the caller asked for, eased

function tick() {
  if (!ctx || !out) return;
  const t = ctx.currentTime, ms = t * 1000;

  // Density: a new target every few seconds, eased toward continuously.
  if (ms > dens.until) {
    dens.to = rnd(T.density.min, T.density.max);
    dens.until = ms + rnd(T.density.period[0], T.density.period[1]) * 1000;
  }
  dens.now += (dens.to - dens.now) * 0.06;

  // Manoeuvre: arm one, hold it, then fall back over a slower curve than it came on.
  if (ms > man.next) {
    man.to = rnd(0.3, 0.7);
    man.until = ms + rnd(T.manoeuvre.hold[0], T.manoeuvre.hold[1]) * 1000;
    man.back = rnd(T.manoeuvre.back[0], T.manoeuvre.back[1]);
    man.next = man.until + rnd(T.manoeuvre.every[0], T.manoeuvre.every[1]) * 1000;
  }
  const target = ms < man.until ? man.to : 0;
  man.amt += (target - man.amt) * (target > man.amt ? 0.35 : clamp(TICK_MS / (man.back * 1000), 0.01, 1));

  // The flock's place. It moves a long way during a manoeuvre and crawls the rest of the time.
  if (Math.abs(field.centre - field.to) < 0.04) field.to = clamp(rnd(-0.6, 0.6) * (1 + man.amt), -0.85, 0.85);
  field.centre += (field.to - field.centre) * (man.amt > 0.1 ? 0.10 : 0.02);
  field.spread = clamp(0.7 * (1 + man.amt * 0.5), 0, 1);

  // Level. The wings swell with a manoeuvre; the calls do it by there being more of them.
  bedGain += (bedTarget - bedGain) * 0.10;
  out.gain.setTargetAtTime(bedGain * T.master, t, 0.12);
  if (wing) wing.level.gain.setTargetAtTime(db(T.mix.wings + sizeMix + man.amt * 6), t, 0.25);

  // Book the window. The gaps are exponential, which is what makes the events genuinely
  // independent — evenly spaced events at any rate are a machine, and they never overlap the way
  // a real flock's do.
  const rate = (T.rateFloor + (rnd(T.callRate[0], T.callRate[1]) - T.rateFloor) * dens.now) * (1 + man.amt);
  const fRate = rnd(T.flutter.rate[0], T.flutter.rate[1]) * dens.now * (1 + man.amt);
  if (booked < t) booked = t + 0.02;
  const until = t + WINDOW;
  while (booked < until) {
    booked += -Math.log(1 - Math.random()) / Math.max(1, rate);
    if (booked >= until) break;
    chirp(booked, {
      dist: rollDistance(man.amt * 0.2),
      centre: field.centre,
      spread: field.spread,
      bright: chance(0.25),
    });
    if (chance(fRate / Math.max(1, rate))) flutter(booked + rnd(0, 0.05));
  }

  if (chance(0.25)) wingDrift();
  if (chance(0.06)) bodyDrift();
}

// ── PUBLIC API ───────────────────────────────────────────────────────────────
//
// One entry point. The caller says how close the nearest murmuration is and how big it is; this
// decides everything else. It's called every frame with null when there's no cloud in earshot, so
// it has to be cheap and idempotent on the no-change path.
let running = false;

/**
 * @param {?{ near: number, birds: number }} flock
 *   `near` is 0 at the edge of earshot and 1 overhead; `birds` is the flock's size, which sets
 *   how much of the bed is wings and how thick the calls are. null stops the bed.
 */
export function setMurmurAudio(flock) {
  if (!flock || !(flock.near > 0)) { stop(); return; }
  if (!start()) return;
  // ⚠ SIZE MOVES THE MIX, NOT THE VOLUME. Four hundred birds and seventeen hundred are the same
  // loudness at the same distance and a very different sound: the big one is mostly wings and the
  // small one mostly voices, which is what makes the cloud read as having a count.
  const n = clamp((flock.birds || 450) / 1200, 0.2, 1.4);
  sizeMix = (n - 1) * 5;
  bedTarget = clamp(flock.near, 0, 1);
  // Air takes the top off a distant flock before it takes the level off — the same curve the
  // per-bird distance bands apply, one scale up.
  if (tone) tone.frequency.setTargetAtTime(clamp(4000 + 8000 * flock.near, 3000, 12000), ctx.currentTime, 0.4);
}

/** A hawk went through the cloud. The flock doesn't discuss it — it just goes. */
export function murmurStartle() {
  if (!running) return;
  const ms = ctx.currentTime * 1000;
  man.to = rnd(0.7, 1.0);
  man.until = ms + rnd(1.2, 2.6) * 1000;
  man.back = rnd(0.8, 1.6);
  man.next = man.until + rnd(T.manoeuvre.every[0], T.manoeuvre.every[1]) * 1000;
}

function start() {
  if (running) return true;
  if (!ensureNodes()) return false;
  buildChain(); buildWing(); buildBody();
  booked = 0; bedGain = 0;
  man.amt = 0; man.until = 0;
  man.next = ctx.currentTime * 1000 + rnd(T.manoeuvre.every[0], T.manoeuvre.every[1]) * 1000;
  running = true;
  timer = setInterval(tick, TICK_MS);
  return true;
}

function stop() {
  if (!running) return;
  running = false;
  clearInterval(timer); timer = null;
  const t = ctx.currentTime;
  try { out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, 0.5); } catch {}
  const w = wing, b = body, o = out, c = comp, n = tone;
  wing = body = out = comp = tone = null;
  bedGain = bedTarget = 0;
  // ⚠ TORN DOWN AFTER THE TAIL, NOT ON THE SPOT. Half the chirps in flight are already booked
  // against the audio clock, and cutting their destination out from under them is a click.
  setTimeout(() => {
    try { w?.src.stop(); for (const s of w?.sides || []) s.lfo.stop(); } catch {}
    try { for (const p of b?.parts || []) { p.car.stop(); p.mod.stop(); } } catch {}
    try { w?.level.disconnect(); b?.level.disconnect(); o?.disconnect(); c?.disconnect(); n?.disconnect(); } catch {}
  }, 1600);
}

// The dev surface. A murmuration is a rare thing to be standing under, and a bed you can only
// hear by finding one is a bed nobody tunes: __murmurAudio.setMurmurAudio({ near: 1, birds: 900 })
// puts one overhead from the console.
if (typeof window !== 'undefined') {
  window.__murmurAudio = { setMurmurAudio, murmurStartle, T, state: () => ({ running, live, dens, man, field }) };
}
