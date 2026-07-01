// One-shot migration: tune the emergency siren to match real civil-defense
// tornado siren behaviour (Federal Signal Thunderbolt-class wail pattern).
// Run once: node server/models/temp/update-siren-sound.js
import { query } from '../db.js';

// 600 Hz centre, slow sweep via vibrato LFO (0.1 Hz, ±900 cents → 357–1009 Hz).
// FM modulator at 420 Hz (index ≈ 0.47) adds the characteristic eerie wail;
// echo (18% mix, 0.22 s delay, 0.4 feedback) gives outdoor spatial depth.
// Sine carrier keeps the FM sidebands clean; 3 s attack mirrors spin-up.
const config = {
  waveform: 'sine',
  freq: 600,
  gain: 0.8,
  noiseMix: 0.02,
  filter: { type: 'lowpass', freq: 3500, q: 0.8 },
  vibrato: { rate: 0.1, depth: 900 },
  fm: { rate: 420, depth: 280 },
  echo: { mix: 0.18, delay: 0.22, feedback: 0.4 },
  adsr: { a: 3.0, d: 0.1, s: 1, r: 4.0 },
};

await query(
  `UPDATE audio_ambient SET config=$1 WHERE id='amb_emergency_siren'`,
  [JSON.stringify(config)]
);
console.log('✓ Emergency siren updated.');
process.exit(0);
