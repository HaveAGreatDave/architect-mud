// One-shot migration: update the emergency siren to a proper tornado-style civil
// defense wail — very low base pitch, massive slow sweep, no amplitude tremolo.
// Run once: node server/models/temp/update-siren-sound.js
import { query } from '../db.js';

// 220 Hz base, vibrato LFO at 0.055 Hz (≈18 s per cycle) with ±1300 cent depth
// sweeps the pitch from ~102 Hz up to ~477 Hz — deep, slow, ominous.
const config = {
  waveform: 'sawtooth',
  freq: 220,
  gain: 0.75,
  noiseMix: 0.05,
  filter: { type: 'lowpass', freq: 2200, q: 0.9 },
  vibrato: { rate: 0.055, depth: 1300 },
  adsr: { a: 2.0, d: 0.1, s: 1, r: 3.5 },
};

await query(
  `UPDATE audio_ambient SET config=$1 WHERE id='amb_emergency_siren'`,
  [JSON.stringify(config)]
);
console.log('✓ Emergency siren updated.');
process.exit(0);
