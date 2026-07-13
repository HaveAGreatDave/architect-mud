// Yacht ambience — the Echelon's location-gated soundscape, synthesised on the game AudioEngine
// (ambient bus, so it respects mute + the Ambient volume). The server tags each room's look/move
// with `ambience`: 'naval' on the open decks, 'engine' in the engine spaces, null everywhere else
// — so the harbor voice (gulls, fog horns, buoy bells, creaking dockwork) is heard ON DECK but
// never in the suites, and the engine rumble only below. A `yacht_underway` push (sent when she
// sails) swells the engine rumble, decaying back to idle.
//
// FM sound design: every discrete naval event (gull, fog horn, bell, creak, clank, chain, hull
// impact) is a 2-operator FM patch — a sine carrier with a sine modulator (`fm:{rate,depth}`,
// depth = Hz deviation so index = depth/carrier), decorated with pitch bends, cents-vibrato and
// slow amplitude tremolo. The character is deliberately synthetic — OPL / Genesis / early-FM —
// while still reading as a cold industrial harbor. Only the water/wind bed stays filtered noise
// (surf is broadband by nature). Events are spaced by long silences so the space can breathe.

const AE = () => window.AudioEngine;
const NAVAL = 'yacht-naval', ENGINE = 'yacht-engine';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// A 2-operator FM voice: sine carrier at `freq`, sine modulator at freq*ratio, modulation index
// `index` (engine wants the deviation in Hz, so depth = index*freq). Any extra layer props
// (adsr/filter/vibrato/tremolo/pitchBend/detune/gain) merge on top.
const fmVoice = (freq, ratio, index, opts = {}) => ({
  waveform: 'sine', freq, fm: { rate: freq * ratio, depth: index * freq }, ...opts,
});

// Fire an FM one-shot onto the ambient bus (respects mute + the Ambient volume).
function sfx(layers, duration) {
  const ae = AE(); if (!ae?.playSfx) return;
  try { ae.playSfx({ category: 'ambient', config: { duration, layers } }); } catch {}
}

// Looping beds (filtered-noise / low-osc layers — the AudioEngine synthesises them, no samples).
const NAVAL_BED = [
  { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 900, q: 0.5 }, adsr: { a: 2, d: 0, s: 1, r: 2 }, gain: 0.06 },   // surf hiss
  { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 320, q: 0.7 }, adsr: { a: 2, d: 0, s: 1, r: 2 }, gain: 0.05 },     // swell wash
  { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 2100, q: 0.4 }, adsr: { a: 2.5, d: 0, s: 1, r: 2 }, gain: 0.02 }, // wind aloft
];
const ENGINE_BED = [
  { waveform: 'sine', freq: 44, adsr: { a: 1.5, d: 0, s: 1, r: 1.5 }, gain: 0.13 },
  { waveform: 'sawtooth', freq: 46, filter: { type: 'lowpass', freq: 150, q: 0.8 }, adsr: { a: 1.5, d: 0, s: 1, r: 1.5 }, gain: 0.06 },
  { waveform: 'sine', freq: 88, adsr: { a: 1.5, d: 0, s: 1, r: 1.5 }, gain: 0.03 },
];

// ── Seagulls ──────────────────────────────────────────────────────────────────
// A bright FM cry: sharp attack, then the pitch falls and warbles (vibrato) as it fades. Every
// cry re-rolls ratio, index, pitch, vibrato and duration so no two are alike.
function gullCry(base, detune = 0) {
  return [
    fmVoice(base, rnd(1.8, 3.2), rnd(1.5, 3.5), {
      detune,
      pitchBend: { to: base * rnd(0.55, 0.68), time: rnd(0.18, 0.28) },
      vibrato: { rate: rnd(11, 20), depth: rnd(18, 55) },
      filter: { type: 'bandpass', freq: base, q: 2.5 },
      adsr: { a: rnd(0.015, 0.035), d: 0.06, s: 0.55, r: 0.12 }, gain: 0.055,
    }),
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: base * 1.6, q: 2 }, adsr: { a: 0.02, d: 0.04, s: 0.3, r: 0.1 }, gain: 0.012 },
  ];
}
// A burst of 2–4 falling "kaws"; sometimes 1–2 extra detuned voices circle overhead alongside.
function gull() {
  const n = 2 + Math.floor(Math.random() * 3), base = rnd(820, 1300);
  const extra = Math.random() < 0.35 ? 1 + Math.floor(Math.random() * 2) : 0;
  for (let i = 0; i < n; i++) setTimeout(() => {
    const f = base * (1 - i * 0.07) * rnd(0.97, 1.03);
    const layers = gullCry(f);
    for (let e = 0; e < extra; e++) layers.push(...gullCry(f * rnd(0.94, 1.06), rnd(20, 45) * (e ? 1 : -1)));
    sfx(layers, 0.4);
  }, i * rnd(120, 200));
}

// ── Fog horns ───────────────────────────────────────────────────────────────
// A deep sine-heavy FM brass drone: slow attack, long release, a whisper of harmonic modulation
// for warmth, gentle cents-vibrato for pitch instability and a slow tremolo swell. Massive and
// distant (lowpassed). Sometimes a two-tone blast — a lower answer follows the first.
function blast(freq, dur) {
  const rel = rnd(2.5, 3.8), atk = rnd(1.2, 2.0);
  sfx([
    fmVoice(freq, pick([1, 2]), rnd(0.3, 0.8), {
      vibrato: { rate: rnd(0.3, 0.6), depth: rnd(8, 16) },
      tremolo: { rate: rnd(0.15, 0.3), depth: 0.2 },
      filter: { type: 'lowpass', freq: rnd(600, 900), q: 0.7 },
      adsr: { a: atk, d: 0.4, s: 0.85, r: rel }, gain: 0.11,
    }),
    fmVoice(freq * 0.5, 1, 0.4, { filter: { type: 'lowpass', freq: 400, q: 0.7 }, adsr: { a: atk, d: 0.4, s: 0.8, r: rel }, gain: 0.06 }),
    fmVoice(freq * 2, 1, 0.5, { adsr: { a: atk + 0.2, d: 0.5, s: 0.5, r: 2.2 }, gain: 0.02 }),
  ], dur);
}
function foghorn() {
  const base = rnd(90, 125);
  blast(base, rnd(2.4, 3.4));
  if (Math.random() < 0.5) setTimeout(() => blast(base * rnd(0.72, 0.8), rnd(2.6, 3.6)), rnd(1500, 2000));
}

// ── Harbor bells ──────────────────────────────────────────────────────────────
// A struck buoy/navigation bell: inharmonic FM ratio (tubular-bell character), a bright transient
// and a long shimmering decay. Random detune + decay length so strikes never sound mechanical.
// Bigger bells ring lower. Sometimes a slow double-strike as the buoy rocks on the swell.
function strike(freq) {
  const ratio = pick([1.4, 2.76, 3.5]);
  sfx([
    fmVoice(freq, ratio, rnd(2, 4), { detune: rnd(-12, 12), adsr: { a: 0.001, d: rnd(1.2, 2.4), s: 0, r: rnd(0.8, 1.6) }, gain: 0.05 }),
    fmVoice(freq * 4, 1, 1, { adsr: { a: 0.001, d: 0.12, s: 0, r: 0.1 }, gain: 0.02 }),                                    // strike transient
    fmVoice(freq * 2.7, 1, 0.5, { detune: rnd(-8, 8), adsr: { a: 0.001, d: rnd(1.5, 2.8), s: 0, r: 1.4 }, gain: 0.015 }),  // shimmering partial
  ], rnd(1.5, 2.8));
}
function bell() {
  const base = rnd(300, 880);
  strike(base);
  if (Math.random() < 0.4) setTimeout(() => strike(base * rnd(0.99, 1.01)), rnd(600, 1100));
}

// ── Harbor atmosphere ─────────────────────────────────────────────────────────
// Infrequent, restrained texture: mooring creaks, dock clanks, chain rattles, halyard taps and
// distant hull impacts. Noticed subconsciously more than consciously.
function creak() {   // rope/piling groan — FM sweep bending slowly upward
  const f = rnd(120, 260);
  sfx([fmVoice(f, rnd(2.5, 4.5), rnd(1.5, 3), {
    pitchBend: { to: f * rnd(1.05, 1.25), time: rnd(0.5, 0.9) },
    filter: { type: 'bandpass', freq: f * 2, q: 4 },
    adsr: { a: rnd(0.1, 0.25), d: 0.3, s: 0.4, r: rnd(0.4, 0.8) }, gain: 0.03,
  })], rnd(0.5, 1.0));
}
function halyard() {  // a line tapping the mast — bright metallic ping
  const f = rnd(1400, 2200);
  sfx([
    fmVoice(f, 1.4, rnd(1, 2), { adsr: { a: 0.001, d: 0.3, s: 0, r: 0.1 }, gain: 0.03 }),
    fmVoice(f * 2.7, 1, 0.5, { adsr: { a: 0.001, d: 0.15, s: 0, r: 0.05 }, gain: 0.012 }),
  ], 0.4);
}
function clank() {   // dock ironwork — short inharmonic FM knock
  const f = rnd(500, 1100);
  sfx([fmVoice(f, 2.76, rnd(3, 6), { detune: rnd(-20, 20), adsr: { a: 0.002, d: rnd(0.15, 0.3), s: 0, r: 0.12 }, gain: 0.035 })], 0.35);
}
function chain() {   // rattle — a scatter of short metallic ticks
  const n = 4 + Math.floor(Math.random() * 5), f = rnd(700, 1300);
  for (let i = 0; i < n; i++) setTimeout(() => {
    sfx([fmVoice(f * rnd(0.85, 1.2), 2.76, rnd(2, 5), { adsr: { a: 0.001, d: rnd(0.04, 0.09), s: 0, r: 0.04 }, gain: 0.02 })], 0.12);
  }, i * rnd(40, 90));
}
function thud() {    // distant ship/hull impact across the water
  const f = rnd(60, 100);
  sfx([
    fmVoice(f, 1, 0.5, { filter: { type: 'lowpass', freq: 300, q: 1 }, adsr: { a: 0.004, d: rnd(0.2, 0.4), s: 0, r: 0.15 }, gain: 0.07 }),
    { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 220, q: 1 }, adsr: { a: 0.004, d: 0.12, s: 0, r: 0.1 }, gain: 0.02 },
  ], 0.4);
}
const atmos = () => pick([creak, clank, chain, halyard, thud])();

// ── Beds + scheduler ────────────────────────────────────────────────────────
let kind = null;          // 'naval' | 'engine' | null (current)
let moving = 0;           // 0..1 making-way level (decays)
let nextGull = 0, nextHorn = 0, nextBell = 0, nextAtmos = 0;
let timer = null, lastT = 0;

function startBed(id, layers, gain) {
  const ae = AE(); if (!ae) return;
  try { ae.init?.(); ae.loopSound({ id, category: 'ambient', config: { gain: 1, layers } }); ae.setLoopGain?.(id, 0, 0.05); ae.setLoopGain?.(id, gain, 1.2); } catch {}
}
function stopBed(id) {
  const ae = AE(); if (!ae) return;
  try { ae.setLoopGain?.(id, 0, 0.8); } catch {}
  setTimeout(() => { try { AE()?.stopLoop?.(id); } catch {} }, 900);
}

function ensureTimer() {
  if (timer) return;
  lastT = performance.now();
  timer = setInterval(() => {
    const now = performance.now(), dt = Math.min(1, (now - lastT) / 1000); lastT = now;
    moving = Math.max(0, moving - dt / 16);   // making-way decays over ~16 s back to idle
    if (kind === 'engine') { try { AE()?.setLoopGain?.(ENGINE, 0.4 + moving * 0.6, 0.4); } catch {} }
    if (kind === 'naval') {
      if (now >= nextGull)  { gull();    nextGull  = now + rnd(12000, 26000); }
      if (now >= nextHorn)  { foghorn(); nextHorn  = now + rnd(150000, 280000); }  // every few minutes
      if (now >= nextBell)  { bell();    nextBell  = now + rnd(22000, 48000); }
      if (now >= nextAtmos) { atmos();   nextAtmos = now + rnd(14000, 34000); }
    }
  }, 500);
}

// Called from dispatch on every look/move with the room's `ambience` tag.
export function setYachtAmbience(next) {
  next = next === 'naval' || next === 'engine' ? next : null;
  if (next === kind) return;
  if (kind === 'naval') stopBed(NAVAL);
  if (kind === 'engine') stopBed(ENGINE);
  kind = next;
  if (kind === 'naval') {
    startBed(NAVAL, NAVAL_BED, 0.6);
    const t = performance.now();
    nextGull = t + rnd(2000, 6000); nextHorn = t + rnd(20000, 60000); nextBell = t + rnd(8000, 18000); nextAtmos = t + rnd(10000, 22000);
    ensureTimer();
  }
  else if (kind === 'engine') { startBed(ENGINE, ENGINE_BED, 0.4 + moving * 0.6); ensureTimer(); }
  else if (!kind && timer) { clearInterval(timer); timer = null; }
}

// Called from dispatch on `yacht_underway` — swell the engine rumble (heard below decks).
export function yachtUnderway() { moving = 1; ensureTimer(); }
