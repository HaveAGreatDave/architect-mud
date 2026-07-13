// Yacht ambience — the Echelon's location-gated soundscape, synthesised on the game AudioEngine
// (ambient bus, so it respects mute + the Ambient volume). The server tags each room's look/move
// with `ambience`: 'naval' on the open decks, 'engine' in the engine spaces, null everywhere else
// — so gulls & surf are heard ON DECK but never in the suites, and the engine rumble only below.
// A `yacht_underway` push (sent when she sails) swells the engine rumble, decaying back to idle.

const AE = () => window.AudioEngine;
const NAVAL = 'yacht-naval', ENGINE = 'yacht-engine';
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

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

let kind = null;          // 'naval' | 'engine' | null (current)
let moving = 0;           // 0..1 making-way level (decays)
let nextGull = 0, nextClink = 0;
let timer = null, lastT = 0;

// A gull cry — a short burst of 2–4 reedy "kaws", each a band-passed saw sweeping down in pitch.
function gull() {
  const ae = AE(); if (!ae?.playSfx) return;
  const n = 2 + Math.floor(Math.random() * 3), base = 850 + Math.random() * 450;
  for (let i = 0; i < n; i++) setTimeout(() => {
    const f = base * (1 - i * 0.08);
    try {
      ae.playSfx({ config: { duration: 0.3, layers: [
        { waveform: 'sawtooth', freq: f, pitchBend: { to: f * 0.6, time: 0.22 }, filter: { type: 'bandpass', freq: f, q: 3 }, adsr: { a: 0.02, d: 0.06, s: 0.5, r: 0.12 }, gain: 0.05 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: f * 1.5, q: 2 }, adsr: { a: 0.02, d: 0.04, s: 0.3, r: 0.1 }, gain: 0.015 },
      ] } });
    } catch {}
  }, i * 140);
}
// A halyard tapping the mast — a bright metallic ping.
function clink() {
  const ae = AE(); if (!ae?.playSfx) return;
  const f = 1400 + Math.random() * 800;
  try {
    ae.playSfx({ config: { duration: 0.45, layers: [
      { waveform: 'sine', freq: f, adsr: { a: 0.002, d: 0.35, s: 0, r: 0.1 }, gain: 0.03 },
      { waveform: 'sine', freq: f * 2.7, adsr: { a: 0.002, d: 0.18, s: 0, r: 0.05 }, gain: 0.015 },
    ] } });
  } catch {}
}

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
      if (now >= nextGull) { gull(); nextGull = now + 6000 + Math.random() * 9000; }
      if (now >= nextClink) { clink(); nextClink = now + 9000 + Math.random() * 12000; }
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
  if (kind === 'naval') { startBed(NAVAL, NAVAL_BED, 0.6); nextGull = performance.now() + 1500; nextClink = performance.now() + 4000; ensureTimer(); }
  else if (kind === 'engine') { startBed(ENGINE, ENGINE_BED, 0.4 + moving * 0.6); ensureTimer(); }
  else if (!kind && timer) { clearInterval(timer); timer = null; }
}

// Called from dispatch on `yacht_underway` — swell the engine rumble (heard below decks).
export function yachtUnderway() { moving = 1; ensureTimer(); }
