/**
 * One-off utility: seeds a representative starter Audio library (procedural
 * Web Audio assets — NOT the text-based "sounds" table). Run once against a
 * fresh database after `npm run db:schema`. Safe to re-run — instruments/sfx/
 * ambient use fixed ids with ON CONFLICT DO NOTHING, so devpanel edits to
 * those are never overwritten. The starter songs are the exception: they
 * upsert on every run, so revisions here reach DBs that already seeded an
 * earlier version (see upsert() below).
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
  { id: 'inst_lead_soft', name: 'lead_soft', category: 'misc', waveform: 'triangle',
    config: { adsr: { a: 0.02, d: 0.15, s: 0.7, r: 0.3 }, vibrato: { rate: 3, depth: 4 }, filter: { type: 'lowpass', freq: 2500, q: 1 } } },
];

// One-bar (16-step) building block: { stepIndex: noteName } sparse map -> full 16-length array.
function bar(template, instrument, vol = 0.6) {
  const steps = new Array(16).fill(null);
  for (const [idx, note] of Object.entries(template)) steps[Number(idx)] = { note, instrument, vol };
  return steps;
}
function bars(...sections) { return [].concat(...sections); }

// ── explore_loop — 8-bar A/A2/B/B2 ambient melody in A minor pentatonic, 96
// BPM, 128 steps = 20s exactly. Form: A A A2 A B B2 A Cadence.
const _exMelA  = bar({ 0: 'A4', 4: 'C5', 6: 'D5', 8: 'E4', 12: 'D4' }, 'inst_lead_soft', 0.55);
const _exMelA2 = bar({ 0: 'A4', 4: 'C5', 6: 'D5', 8: 'E4', 12: 'G4', 14: 'A4' }, 'inst_lead_soft', 0.55);
const _exMelB  = bar({ 0: 'E5', 4: 'D5', 8: 'C5', 12: 'A4' }, 'inst_lead_soft', 0.6);
const _exMelB2 = bar({ 0: 'G4', 4: 'A4', 6: 'C5', 8: 'D5', 12: 'E4' }, 'inst_lead_soft', 0.55);
const _exMelCadence = bar({ 0: 'D4', 4: 'C4', 8: 'A3' }, 'inst_lead_soft', 0.5);
const _exBassA = bar({ 0: 'A2', 8: 'E2' }, 'inst_triangle_bass', 0.7);
const _exBassB = bar({ 0: 'C3', 8: 'G2' }, 'inst_triangle_bass', 0.7);
const _exBassCadence = bar({ 0: 'A2', 8: 'A2' }, 'inst_triangle_bass', 0.65);

// ── combat_loop — 12-bar A/A/A/Avar/B-bridge driving riff in E minor
// pentatonic, 144 BPM, 192 steps = 20s exactly. Form: A A A Avar B B Bvar B A A Avar A.
const _cbMelA    = bar({ 0: 'E4', 2: 'G4', 4: 'E4', 6: 'A4', 8: 'E4', 10: 'G4', 12: 'B4', 14: 'A4' }, 'inst_square_lead', 0.6);
const _cbMelAvar = bar({ 0: 'E4', 2: 'G4', 4: 'E4', 6: 'A4', 8: 'D5', 10: 'B4', 12: 'A4', 14: 'G4' }, 'inst_square_lead', 0.65);
const _cbMelB    = bar({ 0: 'B4', 4: 'A4', 8: 'G4', 12: 'E4' }, 'inst_square_lead', 0.55);
const _cbMelBvar = bar({ 0: 'D5', 4: 'B4', 8: 'A4', 12: 'G4' }, 'inst_square_lead', 0.6);
const _cbBassA = bar({ 0: 'E2', 4: 'E2', 8: 'E2', 12: 'E2' }, 'inst_triangle_bass', 0.8);
const _cbBassB = bar({ 0: 'G2', 4: 'G2', 8: 'A2', 12: 'A2' }, 'inst_triangle_bass', 0.8);
const _cbPerc   = bar({ 2: 'C2', 6: 'C2', 10: 'C2', 14: 'C2' }, 'inst_noise_perc', 1);

const songs = [
  {
    id: 'song_explore_loop', name: 'explore_loop', category: 'ambient', tempo: 96, priority: 4,
    instrument_ids: ['inst_lead_soft', 'inst_triangle_bass'],
    loop_start: 0, loop_end: 127,
    channels: [
      bars(_exMelA, _exMelA, _exMelA2, _exMelA, _exMelB, _exMelB2, _exMelA, _exMelCadence),
      bars(_exBassA, _exBassA, _exBassA, _exBassA, _exBassB, _exBassB, _exBassA, _exBassCadence),
    ],
  },
  {
    id: 'song_combat_loop', name: 'combat_loop', category: 'combat', tempo: 144, priority: 6,
    instrument_ids: ['inst_square_lead', 'inst_noise_perc', 'inst_triangle_bass'],
    loop_start: 0, loop_end: 191,
    channels: [
      bars(_cbMelA, _cbMelA, _cbMelA, _cbMelAvar, _cbMelB, _cbMelB, _cbMelBvar, _cbMelB, _cbMelA, _cbMelA, _cbMelAvar, _cbMelA),
      bars(_cbPerc, _cbPerc, _cbPerc, _cbPerc, _cbPerc, _cbPerc, _cbPerc, _cbPerc, _cbPerc, _cbPerc, _cbPerc, _cbPerc),
      bars(_cbBassA, _cbBassA, _cbBassA, _cbBassA, _cbBassB, _cbBassB, _cbBassB, _cbBassB, _cbBassA, _cbBassA, _cbBassA, _cbBassA),
    ],
  },
];

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
  { id: 'sfx_combat_hit', name: 'combat_hit', category: 'combat', priority: 7, config: { waveform: 'noise', noiseMix: 0.8, freq: 150, duration: 0.12, adsr: { a: 0.001, d: 0.08, s: 0, r: 0.05 }, filter: { type: 'lowpass', freq: 2500, q: 1 } } },
  { id: 'sfx_combat_death', name: 'combat_death', category: 'combat', priority: 9, config: { waveform: 'sawtooth', freq: 300, duration: 0.8, pitchBend: { to: 60, time: 0.7 }, adsr: { a: 0.001, d: 0.3, s: 0.3, r: 0.4 }, filter: { type: 'lowpass', freq: 1500, q: 1 } } },
  { id: 'sfx_combat_punch', name: 'combat_punch', category: 'combat', priority: 6, config: { waveform: 'triangle', freq: 90, duration: 0.1, noiseMix: 0.3, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.04 }, filter: { type: 'lowpass', freq: 1200, q: 1 } } },
  { id: 'sfx_combat_slash', name: 'combat_slash', category: 'combat', priority: 6, config: { waveform: 'noise', noiseMix: 1, duration: 0.18, adsr: { a: 0.005, d: 0.12, s: 0, r: 0.05 }, filter: { type: 'highpass', freq: 2500, q: 1.5 } } },
  { id: 'sfx_combat_stab', name: 'combat_stab', category: 'combat', priority: 7, config: { layers: [
    { waveform: 'noise', noiseMix: 1, duration: 0.08, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.03 }, filter: { type: 'highpass', freq: 3000, q: 1.5 } },
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

  // Environment (one-shot)
  { id: 'sfx_electrical_buzz', name: 'electrical_buzz', category: 'environment', priority: 3, config: { waveform: 'sawtooth', freq: 180, duration: 0.2, noiseMix: 0.4, adsr: { a: 0.001, d: 0.12, s: 0.2, r: 0.05 }, tremolo: { rate: 50, depth: 0.5 }, filter: { type: 'bandpass', freq: 1000, q: 1 } } },
  { id: 'sfx_thunder', name: 'thunder', category: 'environment', priority: 5, config: { duration: 2.2, layers: [
    { waveform: 'noise', noiseMix: 1, gain: 0.6, adsr: { a: 0.05, d: 1.2, s: 0.2, r: 1 }, filter: { type: 'lowpass', freq: 350, q: 1 } },
    { waveform: 'sine', freq: 50, gain: 0.5, pitchBend: { to: 30, time: 1 }, adsr: { a: 0.02, d: 1, s: 0.3, r: 1.2 } },
  ] } },
];

const ambient = [
  { id: 'amb_rain', name: 'amb_rain', category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.3, adsr: { a: 1, d: 0.1, s: 1, r: 1 }, filter: { type: 'highpass', freq: 1000, q: 0.5 } } },
  { id: 'amb_heavy_rain', name: 'amb_heavy_rain', category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.5, adsr: { a: 0.5, d: 0.1, s: 1, r: 0.8 }, filter: { type: 'highpass', freq: 700, q: 0.4 }, tremolo: { rate: 4, depth: 0.2 } } },
  { id: 'amb_wind', name: 'amb_wind', category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.2, adsr: { a: 1.5, d: 0.1, s: 1, r: 1.5 }, filter: { type: 'lowpass', freq: 600, q: 0.7 }, tremolo: { rate: 0.3, depth: 0.4 } } },
  { id: 'amb_fire', name: 'amb_fire', category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.25, adsr: { a: 0.3, d: 0.1, s: 1, r: 0.4 }, filter: { type: 'bandpass', freq: 2200, q: 0.6 }, tremolo: { rate: 14, depth: 0.6 } } },
  { id: 'amb_generator', name: 'amb_generator', category: 'environment', priority: 1, loop: 1, config: { waveform: 'square', freq: 55, gain: 0.2, noiseMix: 0.2, adsr: { a: 0.2, d: 0.1, s: 1, r: 0.3 }, filter: { type: 'lowpass', freq: 500, q: 1 }, tremolo: { rate: 9, depth: 0.4 } } },
  { id: 'amb_subway', name: 'amb_subway', category: 'environment', priority: 1, loop: 1, config: { waveform: 'noise', noiseMix: 1, gain: 0.3, adsr: { a: 0.5, d: 0.1, s: 1, r: 0.6 }, filter: { type: 'lowpass', freq: 250, q: 1 }, tremolo: { rate: 1.2, depth: 0.3 } } },
  { id: 'amb_machinery', name: 'amb_machinery', category: 'environment', priority: 1, loop: 1, config: { waveform: 'square', freq: 110, gain: 0.18, adsr: { a: 0.1, d: 0.1, s: 1, r: 0.2 }, filter: { type: 'lowpass', freq: 900, q: 1 }, tremolo: { rate: 5, depth: 0.7 } } },
  { id: 'amb_hvac', name: 'amb_hvac', category: 'environment', priority: 1, loop: 1, config: { waveform: 'sine', freq: 90, gain: 0.12, noiseMix: 0.2, adsr: { a: 0.4, d: 0.1, s: 1, r: 0.4 }, filter: { type: 'lowpass', freq: 400, q: 0.7 } } },
  { id: 'amb_neon_hum', name: 'amb_neon_hum', category: 'environment', priority: 1, loop: 1, config: { waveform: 'square', freq: 220, gain: 0.08, noiseMix: 0.15, adsr: { a: 0.1, d: 0.1, s: 1, r: 0.2 }, filter: { type: 'lowpass', freq: 1500, q: 1 }, tremolo: { rate: 60, depth: 0.3 } } },
  { id: 'amb_tv_hum', name: 'amb_tv_hum', category: 'tv', priority: 1, loop: 1, config: { waveform: 'sine', freq: 60, gain: 0.05, noiseMix: 0.15, adsr: { a: 0.5, d: 0.1, s: 1, r: 0.5 }, filter: { type: 'lowpass', freq: 400, q: 0.7 } } },
];

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

// Same as insert(), but overwrites an existing row by id instead of skipping
// it. audio_songs is FK-referenced by zones.audio_theme_id, so a delete+reinsert
// would fail once any zone points at one of these — an UPDATE is FK-safe.
async function upsert(table, cols, row) {
  const values = cols.map(c => _colValue(c, row));
  const placeholders = cols.map((_, i) => `$${i + 2}`).join(',');
  const updates = cols.map(c => `${c}=EXCLUDED.${c}`).join(',');
  await query(
    `INSERT INTO ${table} (id, ${cols.join(',')}) VALUES ($1, ${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
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
  // The original songs were 16-step (~2s) drones that looped constantly — these
  // two are intentionally upserted (not insert-skip) so re-running this script
  // refreshes them to the new ~20s melodic arrangements.
  for (const row of songs) await upsert('audio_songs', ['name', 'category', 'tempo', 'channels', 'loop_start', 'loop_end', 'instrument_ids', 'priority'], row);
  for (const row of sfx) await insert('audio_sfx', ['name', 'category', 'priority', 'config'], row);
  for (const row of ambient) await insert('audio_ambient', ['name', 'category', 'priority', 'config', 'loop'], row);
  console.log(`✓ Seeded ${instruments.length} instruments, ${songs.length} songs, ${sfx.length} sfx, ${ambient.length} ambient defs (existing ids skipped).`);
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
