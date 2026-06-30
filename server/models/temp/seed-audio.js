/**
 * One-off utility: seeds a representative starter Audio library (procedural
 * Web Audio assets — NOT the text-based "sounds" table). Run once against a
 * fresh database after `npm run db:schema`. Safe to re-run — uses fixed ids
 * and ON CONFLICT DO NOTHING, so it never overwrites devpanel edits.
 * Run with: node server/models/temp/seed-audio.js
 */
import { query } from '../db.js';

const instruments = [
  { id: 'inst_square_lead', name: 'square_lead', category: 'misc', waveform: 'square',
    config: { adsr: { a: 0.005, d: 0.05, s: 0.6, r: 0.1 }, filter: { type: 'lowpass', freq: 6000, q: 1 } } },
  { id: 'inst_triangle_bass', name: 'triangle_bass', category: 'misc', waveform: 'triangle',
    config: { adsr: { a: 0.01, d: 0.1, s: 0.8, r: 0.15 }, filter: { type: 'lowpass', freq: 1200, q: 0.7 } } },
  { id: 'inst_noise_perc', name: 'noise_perc', category: 'misc', waveform: 'noise',
    config: { noiseMix: 1, adsr: { a: 0.001, d: 0.08, s: 0, r: 0.05 }, filter: { type: 'highpass', freq: 800, q: 1 } } },
  { id: 'inst_sine_pad', name: 'sine_pad', category: 'misc', waveform: 'sine',
    config: { adsr: { a: 0.3, d: 0.2, s: 0.9, r: 0.6 }, vibrato: { rate: 4, depth: 6 } } },
];

const songs = [
  {
    id: 'song_explore_loop', name: 'explore_loop', category: 'ambient', tempo: 96, priority: 4,
    instrument_ids: ['inst_sine_pad', 'inst_triangle_bass'],
    loop_start: 0, loop_end: 15,
    channels: [
      Array.from({ length: 16 }, (_, i) => (i % 8 === 0 ? { note: 'C3', instrument: 'inst_sine_pad', vol: 0.6 } : null)),
      Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? { note: 'C2', instrument: 'inst_triangle_bass', vol: 0.8 } : null)),
    ],
  },
  {
    id: 'song_combat_loop', name: 'combat_loop', category: 'combat', tempo: 150, priority: 6,
    instrument_ids: ['inst_square_lead', 'inst_noise_perc', 'inst_triangle_bass'],
    loop_start: 0, loop_end: 15,
    channels: [
      Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? { note: ['E4', 'G4', 'E4', 'D4'][(i / 2) % 4], instrument: 'inst_square_lead', vol: 0.7 } : null)),
      Array.from({ length: 16 }, (_, i) => (i % 4 === 2 ? { note: 'C2', instrument: 'inst_noise_perc', vol: 1 } : null)),
      Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? { note: 'E2', instrument: 'inst_triangle_bass', vol: 0.9 } : null)),
    ],
  },
];

const sfx = [
  { id: 'sfx_ui_button', name: 'ui_button', category: 'ui', priority: 3, config: { waveform: 'square', freq: 880, duration: 0.06, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 } } },
  { id: 'sfx_ui_error', name: 'ui_error', category: 'ui', priority: 4, config: { waveform: 'sawtooth', freq: 220, duration: 0.2, adsr: { a: 0.001, d: 0.1, s: 0.2, r: 0.1 }, filter: { type: 'lowpass', freq: 1000, q: 1 } } },
  { id: 'sfx_combat_hit', name: 'combat_hit', category: 'combat', priority: 7, config: { waveform: 'noise', noiseMix: 0.8, freq: 150, duration: 0.12, adsr: { a: 0.001, d: 0.08, s: 0, r: 0.05 }, filter: { type: 'lowpass', freq: 2500, q: 1 } } },
  { id: 'sfx_combat_death', name: 'combat_death', category: 'combat', priority: 9, config: { waveform: 'sawtooth', freq: 300, duration: 0.8, pitchBend: { to: 60, time: 0.7 }, adsr: { a: 0.001, d: 0.3, s: 0.3, r: 0.4 }, filter: { type: 'lowpass', freq: 1500, q: 1 } } },
  { id: 'sfx_terminal_login', name: 'terminal_login', category: 'cyberpunk', priority: 4, config: { waveform: 'square', freq: 660, duration: 0.3, pitchBend: { to: 1320, time: 0.25 }, adsr: { a: 0.005, d: 0.1, s: 0.5, r: 0.1 } } },
  { id: 'sfx_ice_break', name: 'ice_break', category: 'cyberpunk', priority: 6, config: { waveform: 'noise', noiseMix: 0.6, freq: 2000, duration: 0.4, adsr: { a: 0.001, d: 0.15, s: 0.1, r: 0.2 }, filter: { type: 'highpass', freq: 1500, q: 2 } } },
  { id: 'sfx_tv_relay_click', name: 'tv_relay_click', category: 'tv', priority: 2, config: { waveform: 'square', freq: 1200, duration: 0.03, adsr: { a: 0.001, d: 0.02, s: 0, r: 0.01 } } },
];

const ambient = [
  { id: 'amb_rain', name: 'amb_rain', category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.3, adsr: { a: 1, d: 0.1, s: 1, r: 1 }, filter: { type: 'highpass', freq: 1000, q: 0.5 } } },
  { id: 'amb_wind', name: 'amb_wind', category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.2, adsr: { a: 1.5, d: 0.1, s: 1, r: 1.5 }, filter: { type: 'lowpass', freq: 600, q: 0.7 }, tremolo: { rate: 0.3, depth: 0.4 } } },
  { id: 'amb_tv_hum', name: 'amb_tv_hum', category: 'tv', priority: 1, loop: 1, config: { waveform: 'sine', freq: 60, gain: 0.05, noiseMix: 0.15, adsr: { a: 0.5, d: 0.1, s: 1, r: 0.5 }, filter: { type: 'lowpass', freq: 400, q: 0.7 } } },
];

async function insert(table, cols, row) {
  const values = cols.map(c => (c === 'config' || c === 'channels' || c === 'instrument_ids' ? JSON.stringify(row[c] ?? (c === 'config' ? {} : [])) : row[c]));
  const placeholders = cols.map((_, i) => `$${i + 2}`).join(',');
  await query(
    `INSERT INTO ${table} (id, ${cols.join(',')}) VALUES ($1, ${placeholders}) ON CONFLICT (id) DO NOTHING`,
    [row.id, ...values]
  );
}

// Retired: the original tuning sweep read as a rising siren rather than radio
// static, and the burst was made redundant by the continuous static loop now
// handled client-side in tv.js. Clean up rows from any DB that ran the old seed.
const RETIRED_IDS = ['sfx_tv_tuning_sweep', 'sfx_tv_static_burst'];

async function seed() {
  for (const id of RETIRED_IDS) await query('DELETE FROM audio_sfx WHERE id=$1', [id]);
  for (const row of instruments) await insert('audio_instruments', ['name', 'category', 'waveform', 'config'], row);
  for (const row of songs) await insert('audio_songs', ['name', 'category', 'tempo', 'channels', 'loop_start', 'loop_end', 'instrument_ids', 'priority'], row);
  for (const row of sfx) await insert('audio_sfx', ['name', 'category', 'priority', 'config'], row);
  for (const row of ambient) await insert('audio_ambient', ['name', 'category', 'priority', 'config', 'loop'], row);
  console.log(`✓ Seeded ${instruments.length} instruments, ${songs.length} songs, ${sfx.length} sfx, ${ambient.length} ambient defs (existing ids skipped).`);
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
