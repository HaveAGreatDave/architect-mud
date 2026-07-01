/**
 * One-off utility: seeds the Audio library (procedural Web Audio assets —
 * NOT the text-based "sounds" table). Safe to re-run — instruments/sfx/ambient
 * use ON CONFLICT DO NOTHING; songs upsert so revisions here always land.
 * Run with: node server/models/temp/seed-audio.js
 *
 * Song lengths: steps = tempo * 4 (gives exactly 60 seconds per loop).
 *   80 BPM → 20 bars (320 steps)   96 BPM → 24 bars (384 steps)
 *  100 BPM → 25 bars (400 steps)  120 BPM → 30 bars (480 steps)
 *  128 BPM → 32 bars (512 steps)  144 BPM → 36 bars (576 steps)
 *  160 BPM → 40 bars (640 steps)
 */
import { query } from '../db.js';

// ── Instruments ───────────────────────────────────────────────────────────────

const instruments = [
  // Original 5 (DO NOTHING on conflict — devpanel edits survive re-seed)
  { id: 'inst_square_lead', name: 'square_lead', category: 'misc', waveform: 'square',
    config: { adsr: { a: 0.005, d: 0.05, s: 0.6, r: 0.1 }, filter: { type: 'lowpass', freq: 6000, q: 1 } } },
  { id: 'inst_triangle_bass', name: 'triangle_bass', category: 'misc', waveform: 'triangle',
    config: { adsr: { a: 0.01, d: 0.1, s: 0.8, r: 0.15 }, filter: { type: 'lowpass', freq: 1200, q: 0.7 } } },
  { id: 'inst_noise_perc', name: 'noise_perc', category: 'misc', waveform: 'noise',
    config: { noiseMix: 1, adsr: { a: 0.001, d: 0.08, s: 0, r: 0.05 }, filter: { type: 'highpass', freq: 800, q: 1 } } },
  { id: 'inst_sine_pad', name: 'sine_pad', category: 'misc', waveform: 'sine',
    config: { adsr: { a: 0.3, d: 0.2, s: 0.9, r: 0.6 }, vibrato: { rate: 4, depth: 6 } } },
  { id: 'inst_lead_soft', name: 'lead_soft', category: 'misc', waveform: 'triangle',
    config: { adsr: { a: 0.02, d: 0.15, s: 0.7, r: 0.3 }, vibrato: { rate: 3, depth: 4 }, filter: { type: 'lowpass', freq: 2500, q: 1 } } },

  // New instruments
  { id: 'inst_saw_lead', name: 'saw_lead', category: 'misc', waveform: 'sawtooth',
    config: { adsr: { a: 0.003, d: 0.08, s: 0.5, r: 0.12 }, filter: { type: 'lowpass', freq: 4000, q: 1.5 } } },
  { id: 'inst_pluck_bass', name: 'pluck_bass', category: 'misc', waveform: 'triangle',
    config: { adsr: { a: 0.001, d: 0.12, s: 0.2, r: 0.08 }, filter: { type: 'lowpass', freq: 900, q: 2 } } },
  { id: 'inst_sine_bass', name: 'sine_bass', category: 'misc', waveform: 'sine',
    config: { adsr: { a: 0.01, d: 0.15, s: 0.9, r: 0.2 }, filter: { type: 'lowpass', freq: 600, q: 0.7 } } },
  { id: 'inst_pad_dark', name: 'pad_dark', category: 'misc', waveform: 'sine',
    config: { adsr: { a: 0.5, d: 0.3, s: 0.85, r: 0.8 }, vibrato: { rate: 1.5, depth: 8 }, filter: { type: 'lowpass', freq: 1200, q: 0.8 } } },
  { id: 'inst_arp_high', name: 'arp_high', category: 'misc', waveform: 'square',
    config: { adsr: { a: 0.001, d: 0.04, s: 0.3, r: 0.06 }, filter: { type: 'highpass', freq: 1500, q: 1 } } },
  { id: 'inst_noise_hat', name: 'noise_hat', category: 'misc', waveform: 'noise',
    config: { noiseMix: 1, adsr: { a: 0.001, d: 0.04, s: 0, r: 0.02 }, filter: { type: 'highpass', freq: 5000, q: 1 } } },
  { id: 'inst_kick', name: 'kick_drum', category: 'misc', waveform: 'sine',
    config: { adsr: { a: 0.001, d: 0.15, s: 0, r: 0.1 }, filter: { type: 'lowpass', freq: 200, q: 1 } } },
  { id: 'inst_chord_synth', name: 'chord_synth', category: 'misc', waveform: 'square',
    config: { adsr: { a: 0.01, d: 0.2, s: 0.4, r: 0.25 }, filter: { type: 'lowpass', freq: 2200, q: 1.2 }, tremolo: { rate: 0, depth: 0 } } },
  { id: 'inst_organ', name: 'organ', category: 'misc', waveform: 'square',
    config: { adsr: { a: 0.002, d: 0, s: 1.0, r: 0.06 }, filter: { type: 'lowpass', freq: 3000, q: 0.7 }, vibrato: { rate: 6, depth: 5 }, gain: 0.75 } },
  { id: 'inst_snare', name: 'snare', category: 'misc', waveform: 'noise',
    config: { noiseMix: 1, adsr: { a: 0.001, d: 0.08, s: 0.05, r: 0.05 }, filter: { type: 'bandpass', freq: 800, q: 1.5 }, gain: 0.9 } },
  { id: 'inst_open_hat', name: 'open_hat', category: 'misc', waveform: 'noise',
    config: { noiseMix: 1, adsr: { a: 0.001, d: 0.18, s: 0.1, r: 0.15 }, filter: { type: 'highpass', freq: 6000, q: 1 }, gain: 0.7 } },
  { id: 'inst_pulse_narrow', name: 'pulse_narrow', category: 'misc', waveform: 'square',
    config: { adsr: { a: 0.002, d: 0.03, s: 0.6, r: 0.08 }, filter: { type: 'lowpass', freq: 1200, q: 2.5 }, gain: 0.8 } },
];

// ── Step sequencer helpers ────────────────────────────────────────────────────
// bar(template, instrument, vol) — sparse {stepIndex: note} → 16-length array.
// bars(...sections) — concatenate bar arrays into a channel.

function bar(template, instrument, vol = 0.6) {
  const steps = new Array(16).fill(null);
  for (const [idx, note] of Object.entries(template))
    steps[Number(idx)] = { note, instrument, vol };
  return steps;
}
function bars(...sections) { return [].concat(...sections); }

// Silent bar — used to keep channels aligned when a voice rests for a section.
function rest() { return new Array(16).fill(null); }

// ── SONG PATTERNS ─────────────────────────────────────────────────────────────
//
// Scale reference (notes used in each song listed for auditing):
//  A min pent: A C D E G       E min pent: E G A B D
//  D nat min:  D E F G A Bb C  C Dorian:   C D Eb F G A Bb
//  F# min pent: F# A B C# E   G min pent: G Bb C D F
//  C maj pent: C D E G A      B Phrygian: B C D E F# G A
//  A Dorian:   A B C D E F# G  C min pent: C Eb F G Bb
//  D maj pent: D E F# A B

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. explore_loop — 96 BPM, 24 bars (384 steps), A min pentatonic
//    Mood: slow-drifting cyberpunk city atmosphere
//    Structure: Intro(4) A(4) A2(4) B(4) A(4) Outro(4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _exI  = (t, v) => bar(t, 'inst_lead_soft', v);
const _exB  = (t, v) => bar(t, 'inst_triangle_bass', v);
const _exP  = (t, v) => bar(t, 'inst_pad_dark', v);

const exMelIntro  = _exI({ 0:'A4', 8:'E4' }, 0.45);
const exMelA      = _exI({ 0:'A4', 4:'C5', 6:'D5', 8:'E4', 12:'D4' }, 0.55);
const exMelA2     = _exI({ 0:'A4', 4:'C5', 6:'D5', 8:'E4', 12:'G4', 14:'A4' }, 0.55);
const exMelA3     = _exI({ 0:'C5', 3:'D5', 4:'E5', 8:'D5', 12:'C5', 14:'A4' }, 0.6);
const exMelB      = _exI({ 0:'E5', 4:'D5', 8:'C5', 12:'A4' }, 0.6);
const exMelB2     = _exI({ 0:'G4', 4:'A4', 6:'C5', 8:'D5', 12:'E4' }, 0.55);
const exMelOutro  = _exI({ 0:'A4', 4:'G4', 8:'E4', 12:'A3' }, 0.45);

const exBassIntro = _exB({ 0:'A2' }, 0.55);
const exBassA     = _exB({ 0:'A2', 8:'E2' }, 0.7);
const exBassB     = _exB({ 0:'C3', 8:'G2' }, 0.7);
const exBassOutro = _exB({ 0:'A2', 8:'A2' }, 0.55);

const exPadA      = _exP({ 0:'A3' }, 0.35);
const exPadB      = _exP({ 0:'C4' }, 0.3);
const exPadIntro  = _exP({ 0:'A3' }, 0.2);

// 24 bars total
const exploreChannels = [
  bars(exMelIntro, exMelIntro, exMelIntro, exMelIntro,
       exMelA,  exMelA,  exMelA2, exMelA3,
       exMelB,  exMelB2, exMelB,  exMelB2,
       exMelA,  exMelA,  exMelA2, exMelA3,
       exMelB,  exMelB2, exMelA,  exMelA2,
       exMelOutro, exMelOutro, exMelIntro, exMelIntro),
  bars(exBassIntro, exBassIntro, exBassIntro, exBassIntro,
       exBassA, exBassA, exBassA, exBassA,
       exBassB, exBassB, exBassB, exBassB,
       exBassA, exBassA, exBassA, exBassA,
       exBassB, exBassB, exBassA, exBassA,
       exBassOutro, exBassOutro, exBassIntro, exBassIntro),
  bars(exPadIntro, exPadIntro, exPadIntro, exPadIntro,
       exPadA, exPadA, exPadA, exPadA,
       exPadB, exPadB, exPadB, exPadB,
       exPadA, exPadA, exPadA, exPadA,
       exPadB, exPadB, exPadA, exPadA,
       exPadIntro, exPadIntro, exPadIntro, exPadIntro),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. combat_loop — 144 BPM, 36 bars (576 steps), E min pentatonic
//    Mood: intense, relentless, frantic combat
//    Structure: A(4) A(4) Avar(4) B(4) B(4) Bvar(4) A(4) A(4) Avar(4) Coda(4)
//              repeat: A(4)×2 Bvar(4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _cbM = (t, v) => bar(t, 'inst_square_lead', v);
const _cbB = (t, v) => bar(t, 'inst_triangle_bass', v);
const _cbP = (t)    => bar(t, 'inst_noise_perc', 1.0);
const _cbH = (t)    => bar(t, 'inst_noise_hat', 0.6);

const cbMelA    = _cbM({ 0:'E4', 2:'G4', 4:'E4', 6:'A4', 8:'E4', 10:'G4', 12:'B4', 14:'A4' }, 0.6);
const cbMelAvar = _cbM({ 0:'E4', 2:'G4', 4:'E4', 6:'A4', 8:'D5', 10:'B4', 12:'A4', 14:'G4' }, 0.65);
const cbMelB    = _cbM({ 0:'B4', 4:'A4', 8:'G4', 12:'E4' }, 0.55);
const cbMelBvar = _cbM({ 0:'D5', 2:'B4', 4:'A4', 6:'G4', 8:'E5', 10:'D5', 12:'B4', 14:'A4' }, 0.65);
const cbMelC    = _cbM({ 0:'G4', 2:'A4', 4:'B4', 6:'D5', 8:'E5', 12:'D5' }, 0.7);

const cbBassA   = _cbB({ 0:'E2', 4:'E2', 8:'E2', 12:'E2' }, 0.8);
const cbBassB   = _cbB({ 0:'G2', 4:'G2', 8:'A2', 12:'A2' }, 0.8);
const cbBassC   = _cbB({ 0:'B2', 4:'A2', 8:'G2', 12:'E2' }, 0.8);

const cbPerc    = _cbP({ 2:'C2', 6:'C2', 10:'C2', 14:'C2' });
const cbPercFull= _cbP({ 0:'C2', 4:'C2', 8:'C2', 12:'C2' });
const cbHat     = _cbH({ 2:'C4', 6:'C4', 10:'C4', 14:'C4' });
const cbHatFull = _cbH({ 0:'C4', 2:'C4', 4:'C4', 6:'C4', 8:'C4', 10:'C4', 12:'C4', 14:'C4' });

// 36 bars total
const combatChannels = [
  bars(cbMelA, cbMelA, cbMelA, cbMelA,
       cbMelA, cbMelA, cbMelAvar, cbMelAvar,
       cbMelB, cbMelB, cbMelB, cbMelBvar,
       cbMelB, cbMelB, cbMelBvar, cbMelBvar,
       cbMelA, cbMelA, cbMelAvar, cbMelAvar,
       cbMelA, cbMelA, cbMelAvar, cbMelC,
       cbMelC, cbMelC, cbMelB, cbMelBvar,
       cbMelA, cbMelA, cbMelAvar, cbMelAvar,
       cbMelC, cbMelC, cbMelA, cbMelA),
  bars(cbBassA, cbBassA, cbBassA, cbBassA,
       cbBassA, cbBassA, cbBassA, cbBassA,
       cbBassB, cbBassB, cbBassB, cbBassB,
       cbBassB, cbBassB, cbBassB, cbBassC,
       cbBassA, cbBassA, cbBassA, cbBassA,
       cbBassA, cbBassA, cbBassA, cbBassC,
       cbBassC, cbBassC, cbBassB, cbBassB,
       cbBassA, cbBassA, cbBassA, cbBassA,
       cbBassC, cbBassC, cbBassA, cbBassA),
  bars(cbPerc, cbPerc, cbPerc, cbPerc,
       cbPerc, cbPerc, cbPerc, cbPercFull,
       cbPerc, cbPerc, cbPerc, cbPerc,
       cbPerc, cbPerc, cbPercFull, cbPercFull,
       cbPerc, cbPerc, cbPerc, cbPercFull,
       cbPercFull, cbPercFull, cbPercFull, cbPercFull,
       cbPercFull, cbPercFull, cbPerc, cbPerc,
       cbPerc, cbPerc, cbPercFull, cbPercFull,
       cbPercFull, cbPercFull, cbPerc, cbPerc),
  bars(rest(), rest(), cbHat, cbHat,
       cbHat, cbHat, cbHat, cbHatFull,
       cbHat, cbHat, cbHat, cbHat,
       cbHat, cbHat, cbHatFull, cbHatFull,
       cbHat, cbHat, cbHat, cbHatFull,
       cbHatFull, cbHatFull, cbHatFull, cbHatFull,
       cbHatFull, cbHatFull, cbHat, cbHat,
       cbHat, cbHat, cbHatFull, cbHatFull,
       cbHatFull, cbHatFull, cbHat, cbHat),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. neon_rain — 80 BPM, 20 bars (320 steps), D natural minor
//    Mood: late night, melancholic, rain on neon
//    Structure: Intro(4) A(4) A2(4) B(4) A(4) Fade(4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _nrM = (t, v) => bar(t, 'inst_lead_soft', v);
const _nrB = (t, v) => bar(t, 'inst_sine_bass', v);
const _nrP = (t, v) => bar(t, 'inst_pad_dark', v);

const nrMelIntro  = _nrM({ 0:'D4', 8:'F4' }, 0.4);
const nrMelA      = _nrM({ 0:'D4', 4:'F4', 6:'G4', 8:'A4', 12:'G4' }, 0.55);
const nrMelA2     = _nrM({ 0:'D4', 4:'F4', 6:'G4', 8:'A4', 10:'Bb4', 12:'A4', 14:'G4' }, 0.55);
const nrMelB      = _nrM({ 0:'Bb4', 4:'A4', 8:'G4', 12:'F4' }, 0.6);
const nrMelB2     = _nrM({ 0:'C5', 4:'Bb4', 8:'A4', 12:'D4' }, 0.6);
const nrMelFade   = _nrM({ 0:'D4', 6:'F4', 12:'A3' }, 0.35);

const nrBassA     = _nrB({ 0:'D2', 8:'A2' }, 0.65);
const nrBassB     = _nrB({ 0:'Bb2', 8:'F2' }, 0.65);
const nrBassIntro = _nrB({ 0:'D2' }, 0.45);

const nrPadA      = _nrP({ 0:'D3' }, 0.3);
const nrPadB      = _nrP({ 0:'Bb3' }, 0.28);

const neonRainChannels = [
  bars(nrMelIntro, nrMelIntro, nrMelIntro, nrMelIntro,
       nrMelA,  nrMelA,  nrMelA2, nrMelA2,
       nrMelB,  nrMelB2, nrMelB,  nrMelB2,
       nrMelA,  nrMelA,  nrMelA2, nrMelA2,
       nrMelFade, nrMelFade, nrMelFade, nrMelFade),
  bars(nrBassIntro, nrBassIntro, nrBassIntro, nrBassIntro,
       nrBassA, nrBassA, nrBassA, nrBassA,
       nrBassB, nrBassB, nrBassB, nrBassB,
       nrBassA, nrBassA, nrBassA, nrBassA,
       nrBassIntro, nrBassIntro, nrBassIntro, nrBassIntro),
  bars(nrPadA, nrPadA, nrPadA, nrPadA,
       nrPadA, nrPadA, nrPadA, nrPadA,
       nrPadB, nrPadB, nrPadB, nrPadB,
       nrPadA, nrPadA, nrPadA, nrPadA,
       nrPadA, nrPadA, nrPadA, nrPadA),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. grid_crawl — 120 BPM, 30 bars (480 steps), C Dorian
//    Mood: hacking/netrunning, tension building, mechanical
//    Structure: Setup(2) A(4) A(4) B(4) A(4) C(4) A(4) Resolve(4) Drop(4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _gcM = (t, v) => bar(t, 'inst_saw_lead', v);
const _gcB = (t, v) => bar(t, 'inst_pluck_bass', v);
const _gcA = (t, v) => bar(t, 'inst_arp_high', v);
const _gcP = (t)    => bar(t, 'inst_noise_perc', 0.9);
const _gcH = (t)    => bar(t, 'inst_noise_hat', 0.5);

const gcSetup  = _gcM({ 0:'C4', 8:'Eb4' }, 0.4);
const gcMelA   = _gcM({ 0:'C4', 4:'D4', 6:'Eb4', 8:'F4', 12:'G4' }, 0.55);
const gcMelA2  = _gcM({ 0:'C4', 4:'Eb4', 6:'F4', 8:'G4', 10:'A4', 12:'Bb4', 14:'C5' }, 0.6);
const gcMelB   = _gcM({ 0:'Bb4', 4:'A4', 8:'G4', 12:'F4' }, 0.55);
const gcMelB2  = _gcM({ 0:'Bb4', 3:'A4', 4:'G4', 7:'F4', 8:'Eb4', 12:'D4', 14:'C4' }, 0.6);
const gcMelC   = _gcM({ 0:'G4', 2:'A4', 4:'Bb4', 6:'C5', 8:'D5', 12:'C5' }, 0.65);
const gcReslv  = _gcM({ 0:'C4', 4:'G4', 8:'Eb4', 12:'C4' }, 0.5);
const gcDrop   = _gcM({ 0:'C4', 12:'C3' }, 0.45);

const gcBassA  = _gcB({ 0:'C2', 6:'G2', 8:'C2', 14:'Eb2' }, 0.75);
const gcBassB  = _gcB({ 0:'Bb2', 6:'F2', 8:'Bb2', 14:'G2' }, 0.75);
const gcBassC  = _gcB({ 0:'G2', 8:'C2' }, 0.7);

const gcArpA   = _gcA({ 0:'C5', 2:'Eb5', 4:'G5', 6:'Bb5', 8:'C5', 10:'Eb5', 12:'G5', 14:'Bb5' }, 0.35);
const gcArpB   = _gcA({ 0:'Bb4', 2:'D5', 4:'F5', 6:'A5', 8:'Bb4', 10:'D5', 12:'F5', 14:'A5' }, 0.35);

const gcPerc   = _gcP({ 0:'C2', 8:'C2' });
const gcPercOff= _gcP({ 4:'C2', 12:'C2' });
const gcHat    = _gcH({ 2:'C4', 6:'C4', 10:'C4', 14:'C4' });

const gridCrawlChannels = [
  bars(gcSetup, gcSetup,
       gcMelA, gcMelA, gcMelA, gcMelA2,
       gcMelA, gcMelA, gcMelA, gcMelA2,
       gcMelB, gcMelB, gcMelB2, gcMelB2,
       gcMelA, gcMelA, gcMelA, gcMelA2,
       gcMelC, gcMelC, gcMelC, gcMelC,
       gcMelA, gcMelA, gcMelA2, gcMelA2,
       gcReslv, gcReslv, gcDrop, gcDrop),
  bars(gcBassA, gcBassA,
       gcBassA, gcBassA, gcBassA, gcBassA,
       gcBassA, gcBassA, gcBassA, gcBassA,
       gcBassB, gcBassB, gcBassB, gcBassB,
       gcBassA, gcBassA, gcBassA, gcBassA,
       gcBassC, gcBassC, gcBassC, gcBassC,
       gcBassA, gcBassA, gcBassA, gcBassA,
       gcBassC, gcBassC, gcBassA, gcBassA),
  bars(rest(), rest(),
       gcArpA, gcArpA, gcArpA, gcArpA,
       gcArpA, gcArpA, gcArpA, gcArpA,
       gcArpB, gcArpB, gcArpB, gcArpB,
       gcArpA, gcArpA, gcArpA, gcArpA,
       gcArpB, gcArpB, gcArpB, gcArpB,
       gcArpA, gcArpA, gcArpA, gcArpA,
       rest(), rest(), rest(), rest()),
  bars(rest(), rest(),
       gcPerc, gcPerc, gcPerc, gcPerc,
       gcPercOff, gcPercOff, gcPerc, gcPerc,
       gcPerc, gcPerc, gcPerc, gcPerc,
       gcPerc, gcPerc, gcPerc, gcPerc,
       gcPerc, gcPerc, gcPercOff, gcPercOff,
       gcPerc, gcPerc, gcPerc, gcPerc,
       gcPerc, gcPerc, rest(), rest()),
  bars(rest(), rest(),
       rest(), rest(), gcHat, gcHat,
       gcHat, gcHat, gcHat, gcHat,
       gcHat, gcHat, gcHat, gcHat,
       gcHat, gcHat, gcHat, gcHat,
       gcHat, gcHat, gcHat, gcHat,
       gcHat, gcHat, gcHat, gcHat,
       rest(), rest(), rest(), rest()),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. dead_zone — 80 BPM, 20 bars (320 steps), F# minor pentatonic
//    Mood: wasteland, desolate, sparse, oppressive silence
//    Structure: Drift(6) A(4) B(4) A(4) Silence(2)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _dzM = (t, v) => bar(t, 'inst_sine_pad', v);
const _dzB = (t, v) => bar(t, 'inst_sine_bass', v);
const _dzL = (t, v) => bar(t, 'inst_lead_soft', v);

const dzDrift   = _dzM({ 0:'F#3' }, 0.25);
const dzMelA    = _dzL({ 0:'F#4', 8:'A4', 14:'B4' }, 0.4);
const dzMelA2   = _dzL({ 0:'F#4', 6:'E4', 8:'C#4', 12:'A3' }, 0.4);
const dzMelB    = _dzL({ 0:'B4', 8:'A4' }, 0.45);
const dzMelB2   = _dzL({ 0:'C#5', 4:'B4', 8:'A4', 14:'F#4' }, 0.45);
const dzPadA    = _dzM({ 0:'F#3' }, 0.3);
const dzPadB    = _dzM({ 0:'B3' }, 0.28);
const dzBassA   = _dzB({ 0:'F#1', 12:'C#2' }, 0.55);
const dzBassB   = _dzB({ 0:'B1', 12:'A1' }, 0.55);

const deadZoneChannels = [
  bars(dzDrift, dzDrift, dzDrift, dzDrift, dzDrift, dzDrift,
       dzMelA,  dzMelA2, dzMelA,  dzMelA2,
       dzMelB,  dzMelB2, dzMelB,  dzMelB2,
       dzMelA,  dzMelA2, dzMelA,  dzMelA2,
       dzDrift, dzDrift),
  bars(rest(), rest(), rest(), rest(), rest(), rest(),
       dzBassA, dzBassA, dzBassA, dzBassA,
       dzBassB, dzBassB, dzBassB, dzBassB,
       dzBassA, dzBassA, dzBassA, dzBassA,
       rest(), rest()),
  bars(dzPadA, dzPadA, dzPadA, dzPadA, dzPadA, dzPadA,
       dzPadA, dzPadA, dzPadA, dzPadA,
       dzPadB, dzPadB, dzPadB, dzPadB,
       dzPadA, dzPadA, dzPadA, dzPadA,
       dzPadA, dzPadA),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. market_hustle — 120 BPM, 30 bars (480 steps), G minor pentatonic
//    Mood: busy street market, crowded, energy, noise
//    Structure: Intro(2) A(4) A(4) B(4) A(4) B(4) A(4) Break(4) A(4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _mhM = (t, v) => bar(t, 'inst_square_lead', v);
const _mhB = (t, v) => bar(t, 'inst_pluck_bass', v);
const _mhP = (t)    => bar(t, 'inst_noise_perc', 0.9);
const _mhH = (t)    => bar(t, 'inst_noise_hat', 0.55);

const mhIntro  = _mhM({ 0:'G4' }, 0.4);
const mhMelA   = _mhM({ 0:'G4', 3:'Bb4', 4:'C5', 7:'D5', 8:'G4', 11:'F4', 12:'D4' }, 0.6);
const mhMelA2  = _mhM({ 0:'G4', 3:'Bb4', 4:'C5', 6:'D5', 8:'C5', 10:'Bb4', 12:'G4', 14:'F4' }, 0.6);
const mhMelB   = _mhM({ 0:'D5', 4:'C5', 8:'Bb4', 12:'G4' }, 0.55);
const mhMelB2  = _mhM({ 0:'F5', 4:'D5', 6:'C5', 8:'Bb4', 10:'G4', 12:'F4', 14:'G4' }, 0.6);

const mhBassA  = _mhB({ 0:'G2', 4:'D3', 8:'G2', 12:'C3' }, 0.75);
const mhBassB  = _mhB({ 0:'D3', 4:'C3', 8:'Bb2', 12:'G2' }, 0.75);

const mhPerc   = _mhP({ 0:'C2', 8:'C2' });
const mhPercSyn= _mhP({ 0:'C2', 4:'C2', 8:'C2', 12:'C2' });
const mhHat    = _mhH({ 2:'C4', 6:'C4', 10:'C4', 14:'C4' });
const mhHatFast= _mhH({ 1:'C4', 3:'C4', 5:'C4', 7:'C4', 9:'C4', 11:'C4', 13:'C4', 15:'C4' });

const marketHustleChannels = [
  bars(mhIntro, mhIntro,
       mhMelA, mhMelA, mhMelA2, mhMelA2,
       mhMelA, mhMelA, mhMelA2, mhMelA2,
       mhMelB, mhMelB, mhMelB2, mhMelB2,
       mhMelA, mhMelA, mhMelA2, mhMelA2,
       mhMelB, mhMelB, mhMelB2, mhMelB2,
       mhMelA, mhMelA, mhMelA2, mhMelA2,
       mhIntro, mhIntro, mhMelA, mhMelA2),
  bars(mhBassA, mhBassA,
       mhBassA, mhBassA, mhBassA, mhBassA,
       mhBassA, mhBassA, mhBassA, mhBassA,
       mhBassB, mhBassB, mhBassB, mhBassB,
       mhBassA, mhBassA, mhBassA, mhBassA,
       mhBassB, mhBassB, mhBassB, mhBassB,
       mhBassA, mhBassA, mhBassA, mhBassA,
       mhBassA, mhBassA, mhBassA, mhBassA),
  bars(rest(), rest(),
       mhPerc, mhPerc, mhPerc, mhPerc,
       mhPercSyn, mhPercSyn, mhPerc, mhPerc,
       mhPerc, mhPerc, mhPerc, mhPerc,
       mhPercSyn, mhPercSyn, mhPerc, mhPerc,
       mhPerc, mhPerc, mhPercSyn, mhPercSyn,
       mhPercSyn, mhPercSyn, mhPerc, mhPerc,
       rest(), rest(), mhPercSyn, mhPercSyn),
  bars(rest(), rest(),
       mhHat, mhHat, mhHat, mhHat,
       mhHatFast, mhHatFast, mhHat, mhHat,
       mhHat, mhHat, mhHat, mhHat,
       mhHatFast, mhHatFast, mhHat, mhHat,
       mhHat, mhHat, mhHatFast, mhHatFast,
       mhHatFast, mhHatFast, mhHat, mhHat,
       rest(), rest(), mhHat, mhHat),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. upper_deck — 100 BPM, 25 bars (400 steps), C major pentatonic
//    Mood: corporate towers, clean glass, quiet menace behind luxury
//    Structure: Pad(4) A(4) A(4) B(4) A2(4) B2(4) Close(5)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _udM = (t, v) => bar(t, 'inst_lead_soft', v);
const _udB = (t, v) => bar(t, 'inst_sine_bass', v);
const _udP = (t, v) => bar(t, 'inst_pad_dark', v);
const _udC = (t, v) => bar(t, 'inst_chord_synth', v);

const udPad    = _udP({ 0:'C4' }, 0.22);
const udMelA   = _udM({ 0:'C5', 4:'D5', 8:'E5', 12:'G5' }, 0.5);
const udMelA2  = _udM({ 0:'C5', 4:'E5', 6:'G5', 8:'A5', 12:'G5', 14:'E5' }, 0.55);
const udMelB   = _udM({ 0:'G4', 4:'A4', 8:'C5', 12:'D5' }, 0.45);
const udMelB2  = _udM({ 0:'A4', 4:'G4', 8:'E4', 12:'C4' }, 0.45);
const udMelClose=_udM({ 0:'C5', 6:'G4', 8:'E4', 14:'C4' }, 0.38);

const udBassA  = _udB({ 0:'C2', 8:'G2' }, 0.6);
const udBassB  = _udB({ 0:'G2', 8:'C2' }, 0.6);

const udChordA = _udC({ 0:'C3' }, 0.28);
const udChordB = _udC({ 0:'G3' }, 0.26);

const upperDeckChannels = [
  bars(udPad, udPad, udPad, udPad,
       udMelA,  udMelA,  udMelA2, udMelA2,
       udMelA,  udMelA,  udMelA2, udMelA2,
       udMelB,  udMelB,  udMelB2, udMelB2,
       udMelA,  udMelA,  udMelA2, udMelA2,
       udMelB,  udMelB2, udMelB,  udMelB2,
       udMelClose, udMelClose, udMelClose, udMelClose, udPad),
  bars(udBassA, udBassA, udBassA, udBassA,
       udBassA, udBassA, udBassA, udBassA,
       udBassA, udBassA, udBassA, udBassA,
       udBassB, udBassB, udBassB, udBassB,
       udBassA, udBassA, udBassA, udBassA,
       udBassB, udBassB, udBassB, udBassB,
       udBassA, udBassA, udBassA, udBassA, udBassA),
  bars(udPad, udPad, udPad, udPad,
       udChordA, udChordA, udChordA, udChordA,
       udChordA, udChordA, udChordA, udChordA,
       udChordB, udChordB, udChordB, udChordB,
       udChordA, udChordA, udChordA, udChordA,
       udChordB, udChordB, udChordA, udChordA,
       udPad, udPad, udPad, udPad, udPad),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. data_heist — 96 BPM, 24 bars (384 steps), B Phrygian
//    Mood: stealth, suspense, creeping tension, one wrong move
//    Structure: Creep(4) A(4) A2(4) Danger(4) A(4) Resolve(4) Creep(4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _dhM = (t, v) => bar(t, 'inst_saw_lead', v);
const _dhB = (t, v) => bar(t, 'inst_sine_bass', v);
const _dhP = (t, v) => bar(t, 'inst_pad_dark', v);
const _dhA = (t, v) => bar(t, 'inst_arp_high', v);

const dhCreep   = _dhP({ 0:'B3' }, 0.2);
const dhMelA    = _dhM({ 0:'B4', 6:'C5', 8:'B4', 14:'G4' }, 0.45);
const dhMelA2   = _dhM({ 0:'B4', 4:'A4', 6:'G4', 8:'F#4', 12:'E4', 14:'D4' }, 0.45);
const dhMelDngr = _dhM({ 0:'C5', 2:'B4', 4:'C5', 6:'D5', 8:'E5', 10:'D5', 12:'C5', 14:'B4' }, 0.55);
const dhMelRes  = _dhM({ 0:'B4', 8:'F#4' }, 0.4);

const dhBassA   = _dhB({ 0:'B1', 8:'E2' }, 0.6);
const dhBassB   = _dhB({ 0:'G2', 8:'F#2' }, 0.6);

const dhArpA    = _dhA({ 0:'B5', 4:'G5', 8:'E5', 12:'D5' }, 0.3);
const dhArpB    = _dhA({ 0:'C6', 4:'A5', 8:'F#5', 12:'E5' }, 0.3);

const dataHeistChannels = [
  bars(dhCreep, dhCreep, dhCreep, dhCreep,
       dhMelA,  dhMelA,  dhMelA2, dhMelA2,
       dhMelA,  dhMelA,  dhMelA2, dhMelA2,
       dhMelDngr, dhMelDngr, dhMelDngr, dhMelDngr,
       dhMelA,  dhMelA,  dhMelA2, dhMelA2,
       dhMelRes, dhMelRes, dhMelRes, dhMelRes),
  bars(dhBassA, dhBassA, dhBassA, dhBassA,
       dhBassA, dhBassA, dhBassA, dhBassA,
       dhBassA, dhBassA, dhBassA, dhBassA,
       dhBassB, dhBassB, dhBassB, dhBassB,
       dhBassA, dhBassA, dhBassA, dhBassA,
       dhBassA, dhBassA, dhBassA, dhBassA),
  bars(dhCreep, dhCreep, dhCreep, dhCreep,
       rest(), rest(), rest(), rest(),
       dhArpA, dhArpA, dhArpA, dhArpA,
       dhArpB, dhArpB, dhArpB, dhArpB,
       dhArpA, dhArpA, dhArpA, dhArpA,
       dhCreep, dhCreep, dhCreep, dhCreep),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. boss_fight — 160 BPM, 40 bars (640 steps), E minor pentatonic
//    Mood: climactic, overwhelming, walls closing in
//    Structure: Drop(4) A(8) B(8) A(8) Climax(8) A(4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _bfM = (t, v) => bar(t, 'inst_saw_lead', v);
const _bfL = (t, v) => bar(t, 'inst_square_lead', v);
const _bfB = (t, v) => bar(t, 'inst_sine_bass', v);
const _bfP = (t)    => bar(t, 'inst_noise_perc', 1.0);
const _bfH = (t)    => bar(t, 'inst_noise_hat', 0.7);

const bfDrop   = _bfB({ 0:'E1' }, 0.9);
const bfMelA   = _bfM({ 0:'E4', 2:'G4', 4:'A4', 6:'B4', 8:'E4', 10:'G4', 12:'A4', 14:'B4' }, 0.65);
const bfMelA2  = _bfM({ 0:'E5', 2:'D5', 4:'B4', 6:'A4', 8:'G4', 10:'E4', 12:'D4', 14:'E4' }, 0.7);
const bfMelB   = _bfM({ 0:'B4', 2:'D5', 4:'E5', 8:'G5', 12:'E5', 14:'D5' }, 0.65);
const bfMelB2  = _bfM({ 0:'G5', 2:'E5', 4:'D5', 6:'B4', 8:'A4', 10:'G4', 12:'E4', 14:'D4' }, 0.7);
const bfClimax = _bfL({ 0:'E5', 1:'G5', 2:'A5', 3:'B5', 4:'D6', 6:'B5', 8:'A5', 10:'G5', 12:'E5', 14:'D5' }, 0.75);

const bfBassA  = _bfB({ 0:'E2', 4:'E2', 8:'E2', 12:'E2' }, 0.9);
const bfBassB  = _bfB({ 0:'G2', 4:'A2', 8:'B2', 12:'G2' }, 0.9);
const bfBassC  = _bfB({ 0:'E1', 4:'G1', 8:'A1', 12:'B1' }, 0.95);

const bfPerc   = _bfP({ 0:'C2', 8:'C2' });
const bfPercD  = _bfP({ 0:'C2', 4:'C2', 8:'C2', 12:'C2' });
const bfPercFr = _bfP({ 0:'C2', 2:'C2', 4:'C2', 6:'C2', 8:'C2', 10:'C2', 12:'C2', 14:'C2' });
const bfHat    = _bfH({ 2:'C4', 6:'C4', 10:'C4', 14:'C4' });
const bfHatFr  = _bfH({ 1:'C4', 3:'C4', 5:'C4', 7:'C4', 9:'C4', 11:'C4', 13:'C4', 15:'C4' });

const bossFightChannels = [
  bars(bfDrop, bfDrop, bfDrop, bfDrop,
       bfMelA, bfMelA, bfMelA2, bfMelA2, bfMelA, bfMelA, bfMelA2, bfMelA2,
       bfMelB, bfMelB, bfMelB2, bfMelB2, bfMelB, bfMelB, bfMelB2, bfMelB2,
       bfMelA, bfMelA, bfMelA2, bfMelA2, bfMelA, bfMelA, bfMelA2, bfMelA2,
       bfClimax, bfClimax, bfClimax, bfClimax, bfClimax, bfClimax, bfClimax, bfClimax,
       bfMelA, bfMelA, bfMelA2, bfMelA2),
  bars(bfDrop, bfDrop, bfDrop, bfDrop,
       bfBassA, bfBassA, bfBassA, bfBassA, bfBassA, bfBassA, bfBassA, bfBassA,
       bfBassB, bfBassB, bfBassB, bfBassB, bfBassB, bfBassB, bfBassB, bfBassB,
       bfBassA, bfBassA, bfBassA, bfBassA, bfBassA, bfBassA, bfBassA, bfBassA,
       bfBassC, bfBassC, bfBassC, bfBassC, bfBassC, bfBassC, bfBassC, bfBassC,
       bfBassA, bfBassA, bfBassA, bfBassA),
  bars(rest(), rest(), rest(), rest(),
       bfPerc, bfPerc, bfPerc, bfPerc, bfPercD, bfPercD, bfPercD, bfPercD,
       bfPercD, bfPercD, bfPercD, bfPercD, bfPercD, bfPercD, bfPercD, bfPercD,
       bfPercD, bfPercD, bfPercD, bfPercD, bfPercD, bfPercD, bfPercD, bfPercD,
       bfPercFr, bfPercFr, bfPercFr, bfPercFr, bfPercFr, bfPercFr, bfPercFr, bfPercFr,
       bfPercD, bfPercD, bfPercD, bfPercD),
  bars(rest(), rest(), rest(), rest(),
       rest(), rest(), bfHat, bfHat, bfHat, bfHat, bfHat, bfHat,
       bfHat, bfHat, bfHat, bfHat, bfHat, bfHat, bfHat, bfHat,
       bfHat, bfHat, bfHat, bfHat, bfHat, bfHat, bfHat, bfHat,
       bfHatFr, bfHatFr, bfHatFr, bfHatFr, bfHatFr, bfHatFr, bfHatFr, bfHatFr,
       bfHat, bfHat, bfHat, bfHat),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. underground — 128 BPM, 32 bars (512 steps), A Dorian
//     Mood: underground club, bass-heavy, sweaty, mechanical groove
//     Structure: Build(4) A(8) B(8) A(8) Drop(4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _ugM = (t, v) => bar(t, 'inst_saw_lead', v);
const _ugB = (t, v) => bar(t, 'inst_sine_bass', v);
const _ugK = (t)    => bar(t, 'inst_kick', 1.0);
const _ugH = (t)    => bar(t, 'inst_noise_hat', 0.6);
const _ugP = (t, v) => bar(t, 'inst_noise_perc', v);

const ugBuild  = _ugB({ 0:'A1' }, 0.5);
const ugMelA   = _ugM({ 0:'A4', 4:'C5', 8:'D5', 12:'E5' }, 0.5);
const ugMelA2  = _ugM({ 0:'A4', 3:'B4', 4:'C5', 7:'D5', 8:'E5', 11:'D5', 12:'C5', 14:'A4' }, 0.55);
const ugMelB   = _ugM({ 0:'F#5', 4:'E5', 8:'D5', 12:'C5' }, 0.5);
const ugMelB2  = _ugM({ 0:'G5', 4:'F#5', 8:'E5', 12:'D5' }, 0.55);

const ugBassA  = _ugB({ 0:'A1', 4:'A1', 6:'C2', 8:'A1', 12:'A1', 14:'G2' }, 0.85);
const ugBassB  = _ugB({ 0:'D2', 4:'D2', 6:'E2', 8:'D2', 12:'C2', 14:'A1' }, 0.85);

const ugKickA  = _ugK({ 0:'A1', 8:'A1' });
const ugKickB  = _ugK({ 0:'A1', 4:'A1', 8:'A1', 12:'A1' });
const ugHatA   = _ugH({ 4:'C4', 12:'C4' });
const ugHatB   = _ugH({ 2:'C4', 6:'C4', 10:'C4', 14:'C4' });
const ugHatFull= _ugH({ 0:'C4', 2:'C4', 4:'C4', 6:'C4', 8:'C4', 10:'C4', 12:'C4', 14:'C4' });
const ugSnare  = _ugP({ 4:'C2', 12:'C2' }, 0.85);

const undergroundChannels = [
  bars(rest(), rest(), rest(), rest(),
       ugMelA, ugMelA, ugMelA2, ugMelA2, ugMelA, ugMelA, ugMelA2, ugMelA2,
       ugMelB, ugMelB, ugMelB2, ugMelB2, ugMelB, ugMelB, ugMelB2, ugMelB2,
       ugMelA, ugMelA, ugMelA2, ugMelA2, ugMelA, ugMelA, ugMelA2, ugMelA2,
       rest(), rest(), rest(), rest()),
  bars(ugBuild, ugBuild, ugBuild, ugBuild,
       ugBassA, ugBassA, ugBassA, ugBassA, ugBassA, ugBassA, ugBassA, ugBassA,
       ugBassB, ugBassB, ugBassB, ugBassB, ugBassB, ugBassB, ugBassB, ugBassB,
       ugBassA, ugBassA, ugBassA, ugBassA, ugBassA, ugBassA, ugBassA, ugBassA,
       ugBuild, ugBuild, ugBuild, ugBuild),
  bars(rest(), ugKickA, ugKickA, ugKickA,
       ugKickB, ugKickB, ugKickB, ugKickB, ugKickB, ugKickB, ugKickB, ugKickB,
       ugKickB, ugKickB, ugKickB, ugKickB, ugKickB, ugKickB, ugKickB, ugKickB,
       ugKickB, ugKickB, ugKickB, ugKickB, ugKickB, ugKickB, ugKickB, ugKickB,
       ugKickB, ugKickB, ugKickA, rest()),
  bars(rest(), rest(), ugHatA, ugHatA,
       ugHatB, ugHatB, ugHatB, ugHatB, ugHatFull, ugHatFull, ugHatB, ugHatB,
       ugHatB, ugHatB, ugHatB, ugHatB, ugHatFull, ugHatFull, ugHatB, ugHatB,
       ugHatB, ugHatB, ugHatFull, ugHatFull, ugHatB, ugHatB, ugHatFull, ugHatFull,
       ugHatFull, ugHatFull, ugHatA, rest()),
  bars(rest(), rest(), rest(), rest(),
       ugSnare, ugSnare, ugSnare, ugSnare, ugSnare, ugSnare, ugSnare, ugSnare,
       ugSnare, ugSnare, ugSnare, ugSnare, ugSnare, ugSnare, ugSnare, ugSnare,
       ugSnare, ugSnare, ugSnare, ugSnare, ugSnare, ugSnare, ugSnare, ugSnare,
       rest(), rest(), rest(), rest()),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. ghost_signal — 80 BPM, 20 bars (320 steps), C minor pentatonic
//     Mood: ruined zone, ghost town, broken broadcast signal, eerie
//     Structure: Void(6) Signal(4) Void(2) Signal2(4) Void(4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _gsP = (t, v) => bar(t, 'inst_pad_dark', v);
const _gsM = (t, v) => bar(t, 'inst_sine_pad', v);
const _gsL = (t, v) => bar(t, 'inst_saw_lead', v);

const gsVoid   = _gsP({ 0:'C3' }, 0.15);
const gsSignalA= _gsL({ 0:'C5', 6:'Eb5', 8:'C5' }, 0.35);
const gsSignalA2=_gsL({ 0:'Bb4', 6:'G4', 8:'F4', 14:'Eb4' }, 0.35);
const gsSignalB= _gsL({ 0:'G5', 4:'F5', 8:'Eb5', 14:'C5' }, 0.4);
const gsPadA   = _gsM({ 0:'C4' }, 0.2);
const gsPadB   = _gsM({ 0:'Eb4' }, 0.18);

const ghostSignalChannels = [
  bars(gsVoid, gsVoid, gsVoid, gsVoid, gsVoid, gsVoid,
       gsSignalA, gsSignalA2, gsSignalA, gsSignalA2,
       gsVoid, gsVoid,
       gsSignalB, gsSignalB, gsSignalA, gsSignalA2,
       gsVoid, gsVoid, gsVoid, gsVoid),
  bars(gsPadA, gsPadA, gsPadA, gsPadA, gsPadA, gsPadA,
       gsPadA, gsPadA, gsPadA, gsPadA,
       gsPadA, gsPadA,
       gsPadB, gsPadB, gsPadA, gsPadA,
       gsPadA, gsPadA, gsPadA, gsPadA),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. chrome_dawn — 100 BPM, 25 bars (400 steps), D major pentatonic
//     Mood: dawn after a long run, survived, bittersweet triumph
//     Structure: Rise(4) A(4) A2(4) B(4) A(4) B2(4) Coda(5)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const _cdM = (t, v) => bar(t, 'inst_lead_soft', v);
const _cdS = (t, v) => bar(t, 'inst_square_lead', v);
const _cdB = (t, v) => bar(t, 'inst_triangle_bass', v);
const _cdP = (t, v) => bar(t, 'inst_pad_dark', v);

const cdRise   = _cdM({ 0:'D4' }, 0.35);
const cdMelA   = _cdM({ 0:'D5', 4:'E5', 8:'F#5', 12:'A5' }, 0.55);
const cdMelA2  = _cdM({ 0:'D5', 4:'F#5', 6:'A5', 8:'B5', 12:'A5', 14:'F#5' }, 0.6);
const cdMelB   = _cdM({ 0:'A5', 4:'F#5', 8:'E5', 12:'D5' }, 0.55);
const cdMelB2  = _cdS({ 0:'B5', 4:'A5', 6:'F#5', 8:'E5', 10:'D5', 12:'E5', 14:'F#5' }, 0.65);
const cdCoda   = _cdM({ 0:'D5', 6:'B4', 12:'A4' }, 0.45);

const cdBassA  = _cdB({ 0:'D2', 8:'A2' }, 0.65);
const cdBassB  = _cdB({ 0:'A2', 8:'B2' }, 0.65);
const cdBassRise=_cdB({ 0:'D2' }, 0.45);

const cdPadA   = _cdP({ 0:'D3' }, 0.28);
const cdPadB   = _cdP({ 0:'A3' }, 0.26);

const chromeDawnChannels = [
  bars(cdRise, cdRise, cdRise, cdRise,
       cdMelA,  cdMelA,  cdMelA2, cdMelA2,
       cdMelA,  cdMelA,  cdMelA2, cdMelA2,
       cdMelB,  cdMelB,  cdMelB2, cdMelB2,
       cdMelA,  cdMelA,  cdMelA2, cdMelA2,
       cdMelB,  cdMelB2, cdMelB,  cdMelB2,
       cdCoda, cdCoda, cdCoda, cdCoda, cdRise),
  bars(cdBassRise, cdBassRise, cdBassRise, cdBassRise,
       cdBassA, cdBassA, cdBassA, cdBassA,
       cdBassA, cdBassA, cdBassA, cdBassA,
       cdBassB, cdBassB, cdBassB, cdBassB,
       cdBassA, cdBassA, cdBassA, cdBassA,
       cdBassB, cdBassB, cdBassA, cdBassA,
       cdBassRise, cdBassRise, cdBassRise, cdBassRise, cdBassRise),
  bars(cdPadA, cdPadA, cdPadA, cdPadA,
       cdPadA, cdPadA, cdPadA, cdPadA,
       cdPadA, cdPadA, cdPadA, cdPadA,
       cdPadB, cdPadB, cdPadB, cdPadB,
       cdPadA, cdPadA, cdPadA, cdPadA,
       cdPadB, cdPadB, cdPadA, cdPadA,
       cdPadA, cdPadA, cdPadA, cdPadA, cdPadA),
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Song registry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const songs = [
  { id: 'song_explore_loop', name: 'explore_loop',   category: 'ambient', tempo: 96,  priority: 4, loop_start: 0, loop_end: 383,
    instrument_ids: ['inst_lead_soft', 'inst_triangle_bass', 'inst_pad_dark'], channels: exploreChannels },
  { id: 'song_combat_loop',  name: 'combat_loop',    category: 'combat',  tempo: 144, priority: 6, loop_start: 0, loop_end: 575,
    instrument_ids: ['inst_square_lead', 'inst_triangle_bass', 'inst_noise_perc', 'inst_noise_hat'], channels: combatChannels },
  { id: 'song_neon_rain',    name: 'neon_rain',      category: 'ambient', tempo: 80,  priority: 4, loop_start: 0, loop_end: 319,
    instrument_ids: ['inst_lead_soft', 'inst_sine_bass', 'inst_pad_dark'], channels: neonRainChannels },
  { id: 'song_grid_crawl',   name: 'grid_crawl',     category: 'cyberpunk', tempo: 120, priority: 5, loop_start: 0, loop_end: 479,
    instrument_ids: ['inst_saw_lead', 'inst_pluck_bass', 'inst_arp_high', 'inst_noise_perc', 'inst_noise_hat'], channels: gridCrawlChannels },
  { id: 'song_dead_zone',    name: 'dead_zone',      category: 'ambient', tempo: 80,  priority: 3, loop_start: 0, loop_end: 319,
    instrument_ids: ['inst_sine_pad', 'inst_sine_bass', 'inst_lead_soft'], channels: deadZoneChannels },
  { id: 'song_market_hustle',name: 'market_hustle',  category: 'misc',    tempo: 120, priority: 4, loop_start: 0, loop_end: 479,
    instrument_ids: ['inst_square_lead', 'inst_pluck_bass', 'inst_noise_perc', 'inst_noise_hat'], channels: marketHustleChannels },
  { id: 'song_upper_deck',   name: 'upper_deck',     category: 'ambient', tempo: 100, priority: 4, loop_start: 0, loop_end: 399,
    instrument_ids: ['inst_lead_soft', 'inst_sine_bass', 'inst_pad_dark', 'inst_chord_synth'], channels: upperDeckChannels },
  { id: 'song_data_heist',   name: 'data_heist',     category: 'cyberpunk', tempo: 96, priority: 5, loop_start: 0, loop_end: 383,
    instrument_ids: ['inst_saw_lead', 'inst_sine_bass', 'inst_pad_dark', 'inst_arp_high'], channels: dataHeistChannels },
  { id: 'song_boss_fight',   name: 'boss_fight',     category: 'combat',  tempo: 160, priority: 7, loop_start: 0, loop_end: 639,
    instrument_ids: ['inst_saw_lead', 'inst_square_lead', 'inst_sine_bass', 'inst_noise_perc', 'inst_noise_hat'], channels: bossFightChannels },
  { id: 'song_underground',  name: 'underground',    category: 'misc',    tempo: 128, priority: 5, loop_start: 0, loop_end: 511,
    instrument_ids: ['inst_saw_lead', 'inst_sine_bass', 'inst_kick', 'inst_noise_hat', 'inst_noise_perc'], channels: undergroundChannels },
  { id: 'song_ghost_signal', name: 'ghost_signal',   category: 'ambient', tempo: 80,  priority: 3, loop_start: 0, loop_end: 319,
    instrument_ids: ['inst_pad_dark', 'inst_sine_pad', 'inst_saw_lead'], channels: ghostSignalChannels },
  { id: 'song_chrome_dawn',  name: 'chrome_dawn',    category: 'misc',    tempo: 100, priority: 4, loop_start: 0, loop_end: 399,
    instrument_ids: ['inst_lead_soft', 'inst_square_lead', 'inst_triangle_bass', 'inst_pad_dark'], channels: chromeDawnChannels },
];

// ── SFX ───────────────────────────────────────────────────────────────────────

const sfx = [
  // UI
  { id: 'sfx_ui_button', name: 'ui_button', category: 'ui', priority: 3, config: { waveform: 'square', freq: 880, duration: 0.06, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 } } },
  { id: 'sfx_ui_error', name: 'ui_error', category: 'ui', priority: 4, config: { waveform: 'sawtooth', freq: 220, duration: 0.2, adsr: { a: 0.001, d: 0.1, s: 0.2, r: 0.1 }, filter: { type: 'lowpass', freq: 1000, q: 1 } } },
  { id: 'sfx_ui_hover', name: 'ui_hover', category: 'ui', priority: 1, config: { waveform: 'sine', freq: 1400, duration: 0.03, gain: 0.25, adsr: { a: 0.001, d: 0.02, s: 0, r: 0.015 } } },
  { id: 'sfx_ui_confirm', name: 'ui_confirm', category: 'ui', priority: 3, config: { waveform: 'square', freq: 660, duration: 0.12, pitchBend: { to: 990, time: 0.08 }, adsr: { a: 0.001, d: 0.08, s: 0.3, r: 0.05 } } },
  { id: 'sfx_ui_cancel', name: 'ui_cancel', category: 'ui', priority: 3, config: { waveform: 'square', freq: 660, duration: 0.12, pitchBend: { to: 440, time: 0.08 }, adsr: { a: 0.001, d: 0.08, s: 0.3, r: 0.05 } } },
  { id: 'sfx_ui_notification', name: 'ui_notification', category: 'ui', priority: 4, config: { waveform: 'triangle', freq: 1100, duration: 0.4, adsr: { a: 0.002, d: 0.15, s: 0.4, r: 0.3 }, vibrato: { rate: 6, depth: 8 } } },
  { id: 'sfx_ui_menu', name: 'ui_menu', category: 'ui', priority: 2, config: { waveform: 'triangle', freq: 320, duration: 0.07, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.04 }, filter: { type: 'lowpass', freq: 1800, q: 1 } } },

  // Combat
  { id: 'sfx_combat_hit', name: 'combat_hit', category: 'combat', priority: 7, config: { waveform: 'noise', noiseMix: 0.4, freq: 120, duration: 0.12, adsr: { a: 0.003, d: 0.08, s: 0, r: 0.05 }, filter: { type: 'lowpass', freq: 900, q: 1 } } },
  { id: 'sfx_combat_death', name: 'combat_death', category: 'combat', priority: 9, config: { waveform: 'sawtooth', freq: 300, duration: 0.8, pitchBend: { to: 60, time: 0.7 }, adsr: { a: 0.001, d: 0.3, s: 0.3, r: 0.4 }, filter: { type: 'lowpass', freq: 1500, q: 1 } } },
  { id: 'sfx_combat_punch', name: 'combat_punch', category: 'combat', priority: 6, config: { waveform: 'triangle', freq: 90, duration: 0.1, noiseMix: 0.3, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.04 }, filter: { type: 'lowpass', freq: 1200, q: 1 } } },
  { id: 'sfx_combat_slash', name: 'combat_slash', category: 'combat', priority: 6, config: { waveform: 'noise', noiseMix: 0.5, duration: 0.18, adsr: { a: 0.008, d: 0.12, s: 0, r: 0.06 }, filter: { type: 'bandpass', freq: 1000, q: 1.2 } } },
  { id: 'sfx_combat_stab', name: 'combat_stab', category: 'combat', priority: 7, config: { layers: [
    { waveform: 'noise', noiseMix: 0.6, duration: 0.08, adsr: { a: 0.002, d: 0.05, s: 0, r: 0.03 }, filter: { type: 'lowpass', freq: 1200, q: 1 } },
    { waveform: 'triangle', freq: 120, duration: 0.1, gain: 0.6, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 }, filter: { type: 'lowpass', freq: 800, q: 1 } },
  ] } },
  { id: 'sfx_combat_gunshot', name: 'combat_gunshot', category: 'combat', priority: 8, config: { layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.1, adsr: { a: 0.0005, d: 0.06, s: 0, r: 0.04 }, filter: { type: 'highpass', freq: 1500, q: 1 } },
    { waveform: 'sawtooth', freq: 140, duration: 0.15, gain: 0.7, pitchBend: { to: 50, time: 0.12 }, adsr: { a: 0.0005, d: 0.1, s: 0, r: 0.05 }, filter: { type: 'lowpass', freq: 600, q: 1 } },
  ] } },
  { id: 'sfx_combat_reload', name: 'combat_reload', category: 'combat', priority: 3, config: { waveform: 'square', freq: 1500, duration: 0.025, adsr: { a: 0.0005, d: 0.015, s: 0, r: 0.01 } } },
  { id: 'sfx_combat_critical', name: 'combat_critical', category: 'combat', priority: 8, config: { waveform: 'square', freq: 400, duration: 0.25, noiseMix: 0.3, pitchBend: { to: 1200, time: 0.1 }, adsr: { a: 0.001, d: 0.1, s: 0.3, r: 0.12 }, filter: { type: 'highpass', freq: 600, q: 1 } } },

  // Cyberpunk
  { id: 'sfx_terminal_login', name: 'terminal_login', category: 'cyberpunk', priority: 4, config: { waveform: 'square', freq: 660, duration: 0.3, pitchBend: { to: 1320, time: 0.25 }, adsr: { a: 0.005, d: 0.1, s: 0.5, r: 0.1 } } },
  { id: 'sfx_terminal_logout', name: 'terminal_logout', category: 'cyberpunk', priority: 3, config: { waveform: 'square', freq: 1320, duration: 0.3, pitchBend: { to: 440, time: 0.25 }, adsr: { a: 0.005, d: 0.1, s: 0.4, r: 0.12 } } },
  { id: 'sfx_terminal_boot', name: 'terminal_boot', category: 'cyberpunk', priority: 4, config: { waveform: 'triangle', freq: 100, duration: 0.6, pitchBend: { to: 700, time: 0.5 }, adsr: { a: 0.02, d: 0.3, s: 0.5, r: 0.2 }, filter: { type: 'lowpass', freq: 3000, q: 1 } } },
  { id: 'sfx_ice_break', name: 'ice_break', category: 'cyberpunk', priority: 6, config: { waveform: 'noise', noiseMix: 0.6, freq: 2000, duration: 0.4, adsr: { a: 0.001, d: 0.15, s: 0.1, r: 0.2 }, filter: { type: 'highpass', freq: 1500, q: 2 } } },
  { id: 'sfx_hacking', name: 'hacking', category: 'cyberpunk', priority: 4, config: { waveform: 'square', freq: 700, duration: 0.5, noiseMix: 0.4, adsr: { a: 0.01, d: 0.2, s: 0.5, r: 0.15 }, tremolo: { rate: 18, depth: 0.7 }, filter: { type: 'bandpass', freq: 1800, q: 1.5 } } },
  { id: 'sfx_scanner', name: 'scanner', category: 'cyberpunk', priority: 3, config: { waveform: 'square', freq: 900, duration: 0.35, adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.1 }, tremolo: { rate: 12, depth: 0.6 }, vibrato: { rate: 3, depth: 30 } } },
  { id: 'sfx_architect_notice', name: 'architect_notice', category: 'cyberpunk', priority: 9, config: { waveform: 'sine', freq: 70, duration: 1.2, gain: 0.7, adsr: { a: 0.1, d: 0.3, s: 0.8, r: 0.6 }, vibrato: { rate: 1.5, depth: 12 }, filter: { type: 'lowpass', freq: 500, q: 2 } } },

  // TV
  { id: 'sfx_tv_relay_click', name: 'tv_relay_click', category: 'tv', priority: 2, config: { waveform: 'square', freq: 1200, duration: 0.03, adsr: { a: 0.001, d: 0.02, s: 0, r: 0.01 } } },
  { id: 'sfx_tv_power_on',    name: 'tv_power_on',    category: 'tv', priority: 3, config: { waveform: 'triangle', freq: 80, duration: 0.35, noiseMix: 0.3, pitchBend: { to: 600, time: 0.25 }, filter: { type: 'lowpass', freq: 3000, q: 1 }, adsr: { a: 0.005, d: 0.15, s: 0.3, r: 0.15 } } },
  { id: 'sfx_tv_power_off',   name: 'tv_power_off',   category: 'tv', priority: 3, config: { waveform: 'triangle', freq: 900, duration: 0.3, noiseMix: 0.2, pitchBend: { to: 40, time: 0.25 }, filter: { type: 'lowpass', freq: 4000, q: 1 }, adsr: { a: 0.001, d: 0.05, s: 0.2, r: 0.2 } } },

  // Environment
  { id: 'sfx_electrical_buzz', name: 'electrical_buzz', category: 'environment', priority: 3, config: { waveform: 'sawtooth', freq: 180, duration: 0.2, noiseMix: 0.4, adsr: { a: 0.001, d: 0.12, s: 0.2, r: 0.05 }, tremolo: { rate: 50, depth: 0.5 }, filter: { type: 'bandpass', freq: 1000, q: 1 } } },
  { id: 'sfx_thunder', name: 'thunder', category: 'environment', priority: 5, config: { duration: 0.05, adsr: { r: 2.5 }, layers: [
    { waveform: 'noise', noiseMix: 1, gain: 1.0, adsr: { a: 0.02, d: 0.06, s: 0, r: 0.05 } },
    { waveform: 'noise', noiseMix: 1, gain: 0.85, adsr: { a: 0.005, d: 1.0, s: 0.15, r: 1.8 }, filter: { type: 'lowpass', freq: 280, q: 0.7 } },
    { waveform: 'noise', noiseMix: 1, gain: 0.7, adsr: { a: 0.01, d: 1.5, s: 0.2, r: 2.2 }, filter: { type: 'lowpass', freq: 80, q: 0.8 } },
  ] } },
];

// ── Ambient ───────────────────────────────────────────────────────────────────

const ambient = [
  { id: 'amb_rain',        name: 'amb_rain',        category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.3, adsr: { a: 1, d: 0.1, s: 1, r: 1 }, filter: { type: 'highpass', freq: 1000, q: 0.5 } } },
  { id: 'amb_heavy_rain',  name: 'amb_heavy_rain',  category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.5, adsr: { a: 0.5, d: 0.1, s: 1, r: 0.8 }, filter: { type: 'highpass', freq: 700, q: 0.4 }, tremolo: { rate: 4, depth: 0.2 } } },
  { id: 'amb_wind',        name: 'amb_wind',        category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.2, adsr: { a: 1.5, d: 0.1, s: 1, r: 1.5 }, filter: { type: 'lowpass', freq: 600, q: 0.7 }, tremolo: { rate: 0.3, depth: 0.4 } } },
  { id: 'amb_fire',        name: 'amb_fire',        category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.25, adsr: { a: 0.3, d: 0.1, s: 1, r: 0.4 }, filter: { type: 'bandpass', freq: 2200, q: 0.6 }, tremolo: { rate: 14, depth: 0.6 } } },
  { id: 'amb_generator',   name: 'amb_generator',   category: 'environment', priority: 1, loop: 1, config: { waveform: 'square', freq: 55, gain: 0.2, noiseMix: 0.2, adsr: { a: 0.2, d: 0.1, s: 1, r: 0.3 }, filter: { type: 'lowpass', freq: 500, q: 1 }, tremolo: { rate: 9, depth: 0.4 } } },
  { id: 'amb_subway',      name: 'amb_subway',      category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.3, adsr: { a: 0.5, d: 0.1, s: 1, r: 0.6 }, filter: { type: 'lowpass', freq: 250, q: 1 }, tremolo: { rate: 1.2, depth: 0.3 } } },
  { id: 'amb_machinery',   name: 'amb_machinery',   category: 'environment', priority: 1, loop: 1, config: { waveform: 'square', freq: 110, gain: 0.18, adsr: { a: 0.1, d: 0.1, s: 1, r: 0.2 }, filter: { type: 'lowpass', freq: 900, q: 1 }, tremolo: { rate: 5, depth: 0.7 } } },
  { id: 'amb_hvac',        name: 'amb_hvac',        category: 'environment', priority: 1, loop: 1, config: { waveform: 'sine', freq: 90, gain: 0.12, noiseMix: 0.2, adsr: { a: 0.4, d: 0.1, s: 1, r: 0.4 }, filter: { type: 'lowpass', freq: 400, q: 0.7 } } },
  { id: 'amb_neon_hum',    name: 'amb_neon_hum',    category: 'environment', priority: 1, loop: 1, config: { waveform: 'square', freq: 220, gain: 0.08, noiseMix: 0.15, adsr: { a: 0.1, d: 0.1, s: 1, r: 0.2 }, filter: { type: 'lowpass', freq: 1500, q: 1 }, tremolo: { rate: 60, depth: 0.3 } } },
  { id: 'amb_tv_hum',      name: 'amb_tv_hum',      category: 'tv',          priority: 1, loop: 1, config: { waveform: 'sine', freq: 60, gain: 0.05, noiseMix: 0.15, adsr: { a: 0.5, d: 0.1, s: 1, r: 0.5 }, filter: { type: 'lowpass', freq: 400, q: 0.7 } } },
  { id: 'amb_tv_static',        name: 'amb_tv_static',        category: 'tv',          priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.6, filter: { type: 'highpass', freq: 700, q: 0.5 }, tremolo: { rate: 35, depth: 0.6 }, adsr: { a: 0.02, d: 0.02, s: 1, r: 0.3 } } },
  // Tornado/air-raid siren: sawtooth at 550 Hz center, long vibrato sweeps
  // 102–477 Hz over ~18 s per cycle. Deep tornado-style civil defense wail.
  // High priority. Used by Emergency Security Protocol.
  { id: 'amb_emergency_siren',  name: 'amb_emergency_siren',  category: 'environment', priority: 5, loop: 1, config: { waveform: 'sawtooth', freq: 220, gain: 0.75, noiseMix: 0.05, filter: { type: 'lowpass', freq: 2200, q: 0.9 }, vibrato: { rate: 0.055, depth: 1300 }, adsr: { a: 2.0, d: 0.1, s: 1, r: 3.5 } } },
];

// ── DB helpers ────────────────────────────────────────────────────────────────

function _colValue(col, row) {
  return (col === 'config' || col === 'channels' || col === 'instrument_ids')
    ? JSON.stringify(row[col] ?? (col === 'config' ? {} : []))
    : row[col];
}

async function insert(table, cols, row) {
  const values = cols.map(c => _colValue(c, row));
  const placeholders = cols.map((_, i) => `$${i + 2}`).join(',');
  await query(
    `INSERT INTO ${table} (id, ${cols.join(',')}) VALUES ($1, ${placeholders}) ON CONFLICT (id) DO NOTHING`,
    [row.id, ...values]
  );
}

// Songs upsert — audio_songs is FK-referenced by zones.audio_theme_id,
// so delete+reinsert would fail once any zone points at one of them.
async function upsert(table, cols, row) {
  const values = cols.map(c => _colValue(c, row));
  const placeholders = cols.map((_, i) => `$${i + 2}`).join(',');
  const updates = cols.map(c => `${c}=EXCLUDED.${c}`).join(',');
  await query(
    `INSERT INTO ${table} (id, ${cols.join(',')}) VALUES ($1, ${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
    [row.id, ...values]
  );
}

const RETIRED_IDS = ['sfx_tv_tuning_sweep', 'sfx_tv_static_burst'];

async function seed() {
  for (const id of RETIRED_IDS) await query('DELETE FROM audio_sfx WHERE id=$1', [id]);
  for (const row of instruments) await insert('audio_instruments', ['name', 'category', 'waveform', 'config'], row);
  for (const row of songs) await upsert('audio_songs', ['name', 'category', 'tempo', 'channels', 'loop_start', 'loop_end', 'instrument_ids', 'priority'], row);
  for (const row of sfx) await insert('audio_sfx', ['name', 'category', 'priority', 'config'], row);
  for (const row of ambient) await insert('audio_ambient', ['name', 'category', 'priority', 'config', 'loop'], row);
  console.log(`✓ Seeded ${instruments.length} instruments, ${songs.length} songs, ${sfx.length} sfx, ${ambient.length} ambient.`);
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
