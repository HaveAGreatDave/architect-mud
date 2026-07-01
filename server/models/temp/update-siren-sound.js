// One-shot migration: update the emergency siren to lower pitch + longer sweep.
// Run once: node server/models/temp/update-siren-sound.js
import { query } from '../db.js';

const config = {
  waveform: 'sawtooth',
  freq: 550,
  gain: 0.65,
  noiseMix: 0.04,
  filter: { type: 'lowpass', freq: 1600, q: 1.2 },
  vibrato: { rate: 0.15, depth: 320 },
  tremolo: { rate: 0.15, depth: 0.18 },
  adsr: { a: 0.6, d: 0.1, s: 1, r: 2.0 },
};

await query(
  `UPDATE audio_ambient SET config=$1 WHERE id='amb_emergency_siren'`,
  [JSON.stringify(config)]
);
console.log('✓ Emergency siren updated.');
process.exit(0);
