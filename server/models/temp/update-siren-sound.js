// One-shot migration: tune the emergency siren to match real civil-defense
// tornado siren behaviour (Federal Signal Thunderbolt-class wail pattern).
// Run once: node server/models/temp/update-siren-sound.js
import { query } from '../db.js';

// 600 Hz centre, LFO at 0.1 Hz (10 s per cycle) with ±900 cent depth:
// sweeps 357 Hz → 1009 Hz — the authentic civil-defense range.
// Sawtooth approximates the mechanical rotor timbre; small noise mix adds
// motor rumble. 3 s attack mirrors a real siren spinning up from rest.
const config = {
  waveform: 'sawtooth',
  freq: 600,
  gain: 0.8,
  noiseMix: 0.03,
  filter: { type: 'lowpass', freq: 3500, q: 0.8 },
  vibrato: { rate: 0.1, depth: 900 },
  adsr: { a: 3.0, d: 0.1, s: 1, r: 4.0 },
};

await query(
  `UPDATE audio_ambient SET config=$1 WHERE id='amb_emergency_siren'`,
  [JSON.stringify(config)]
);
console.log('✓ Emergency siren updated.');
process.exit(0);
