/**
 * One-shot: softens combat SFX by reducing high-frequency noise content.
 * Run with: node server/models/temp/soften-combat-sfx.js
 */
import { query } from '../db.js';

const updates = [
  // Was: noiseMix 0.8, lowpass 2500Hz — very harsh thump
  // Now: noiseMix 0.4, lowpass 900Hz — dull thud
  {
    id: 'sfx_combat_hit',
    config: { waveform: 'noise', noiseMix: 0.4, freq: 120, duration: 0.12, adsr: { a: 0.003, d: 0.08, s: 0, r: 0.05 }, filter: { type: 'lowpass', freq: 900, q: 1 } },
  },
  // Was: noiseMix 1, highpass 2500Hz — very sharp/metallic
  // Now: noiseMix 0.5, bandpass centred ~1000Hz — softer swish
  {
    id: 'sfx_combat_slash',
    config: { waveform: 'noise', noiseMix: 0.5, duration: 0.18, adsr: { a: 0.008, d: 0.12, s: 0, r: 0.06 }, filter: { type: 'bandpass', freq: 1000, q: 1.2 } },
  },
  // Was: layers with highpass 3000Hz noise — piercing
  // Now: single layer, lowpass only
  {
    id: 'sfx_combat_stab',
    config: { layers: [
      { waveform: 'noise', noiseMix: 0.6, duration: 0.08, adsr: { a: 0.002, d: 0.05, s: 0, r: 0.03 }, filter: { type: 'lowpass', freq: 1200, q: 1 } },
      { waveform: 'triangle', freq: 120, duration: 0.1, gain: 0.6, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 }, filter: { type: 'lowpass', freq: 800, q: 1 } },
    ] },
  },
];

for (const { id, config } of updates) {
  const { rowCount } = await query(
    'UPDATE sounds SET config=$1 WHERE id=$2',
    [JSON.stringify(config), id]
  );
  console.log(`${id}: ${rowCount ? 'updated' : 'not found'}`);
}

process.exit(0);
