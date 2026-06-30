// One-shot script: seed the audio_instruments + audio_songs rows referenced
// by MUSIC <song> cues in data/scripts/*.bsm (acid_cola_jingle, corporate_chime,
// chrome_circumstance_theme, neighbors_theme, tonight_theme). Idempotent —
// safe to re-run; existing rows are overwritten.
// Run once: node scripts/seed-broadcast-music.js
import { query } from '../server/models/db.js';

// ── Instruments ──────────────────────────────────────────────────────────
// Reused across songs the way a tracker reuses a small instrument bank.

const instruments = [
  {
    id: 'aud_inst_lead_square', name: 'Lead Square', category: 'music', waveform: 'square',
    config: { adsr: { a: 0.005, d: 0.04, s: 0.55, r: 0.08 }, filter: { type: 'lowpass', freq: 4000, q: 1 }, gain: 0.9 },
  },
  {
    id: 'aud_inst_bass_triangle', name: 'Bass Triangle', category: 'music', waveform: 'triangle',
    config: { adsr: { a: 0.005, d: 0.05, s: 0.8, r: 0.12 }, gain: 0.85 },
  },
  {
    id: 'aud_inst_bell_sine', name: 'Bell Sine', category: 'music', waveform: 'sine',
    config: { adsr: { a: 0.01, d: 0.4, s: 0.15, r: 0.6 }, gain: 0.7 },
  },
  {
    id: 'aud_inst_pluck_square', name: 'Pluck Square', category: 'music', waveform: 'square',
    config: { adsr: { a: 0.004, d: 0.05, s: 0.3, r: 0.05 }, filter: { type: 'lowpass', freq: 3000, q: 1.2 }, gain: 0.8 },
  },
  {
    id: 'aud_inst_funk_synth', name: 'Funk Synth', category: 'music', waveform: 'sawtooth',
    config: { adsr: { a: 0.005, d: 0.06, s: 0.5, r: 0.07 }, filter: { type: 'lowpass', freq: 1800, q: 3 }, gain: 0.85 },
  },
  {
    id: 'aud_inst_brass_saw', name: 'Brass Saw', category: 'music', waveform: 'sawtooth',
    config: { adsr: { a: 0.01, d: 0.08, s: 0.65, r: 0.15 }, filter: { type: 'lowpass', freq: 2600, q: 1 }, gain: 0.85 },
  },
];

// ── Songs ────────────────────────────────────────────────────────────────
// channels[i] is a step array; the player indexes it modulo its own length,
// so a short motif (one or two bars) repeats for the song's full duration.
// At 15s and STEPS_PER_BEAT=4, total 16th-note steps == tempo (15 * tempo/60 * 4 == tempo),
// so each song's tempo is chosen so a clean bar length divides it evenly.

function tile(motif, total) {
  const out = [];
  for (let i = 0; i < total; i++) out.push(motif[i % motif.length] || null);
  return out;
}

const R = null; // rest

const songs = [
  {
    id: 'aud_song_acid_cola_jingle', name: 'acid_cola_jingle', category: 'commercial', tempo: 144,
    instrument_ids: ['aud_inst_lead_square', 'aud_inst_bass_triangle'],
    melody: ['C5', R, 'E5', R, 'G5', R, 'C6', R, 'B5', R, 'G5', R, 'E5', R, 'D5', R],
    bass:   ['C3', R, 'C3', R, 'G2', R, 'G2', R, 'A2', R, 'A2', R, 'G2', R, R, R],
  },
  {
    id: 'aud_song_corporate_chime', name: 'corporate_chime', category: 'commercial', tempo: 80,
    instrument_ids: ['aud_inst_bell_sine', 'aud_inst_bass_triangle'],
    melody: ['C5', R, R, R, 'E5', R, R, R, 'G5', R, R, R, 'B4', R, R, R],
    bass:   ['C3', R, R, R, R, R, R, R, 'G2', R, R, R, R, R, R, R],
  },
  {
    id: 'aud_song_chrome_circumstance_theme', name: 'chrome_circumstance_theme', category: 'theme', tempo: 128,
    instrument_ids: ['aud_inst_pluck_square', 'aud_inst_bass_triangle'],
    melody: ['C4', 'C5', R, 'G4', R, 'E4', 'C4', R, 'D4', 'D5', R, 'A4', R, 'F4', 'D4', R],
    bass:   ['C3', R, 'C3', R, 'F3', R, 'F3', R, 'G3', R, 'G3', R, 'C3', R, R, R],
  },
  {
    id: 'aud_song_neighbors_theme', name: 'neighbors_theme', category: 'theme', tempo: 120,
    instrument_ids: ['aud_inst_funk_synth', 'aud_inst_bass_triangle'],
    melody: ['G4', R, 'Bb4', 'C5', R, 'D5', R, 'C5', 'Bb4', R, 'G4', R, R, 'F4', 'G4', R],
    bass:   ['G2', 'G3', R, 'G2', R, 'G2', 'G3', R, 'F2', 'F3', R, 'F2', R, R, 'G2', R],
  },
  {
    id: 'aud_song_tonight_theme', name: 'tonight_theme', category: 'theme', tempo: 132,
    instrument_ids: ['aud_inst_brass_saw'],
    melody: ['C4', 'E4', 'G4', 'C5', R, R, 'B4', 'C5', R, R, 'D5', 'C5', 'B4', 'G4', R, R],
    bass:   ['C3', R, R, R, 'G2', R, R, R, 'A2', R, R, R, 'G2', R, R, R],
  },
];

for (const ins of instruments) {
  await query(
    `INSERT INTO audio_instruments (id, name, category, waveform, config, enabled)
     VALUES ($1,$2,$3,$4,$5,1)
     ON CONFLICT (id) DO UPDATE SET name=$2, category=$3, waveform=$4, config=$5`,
    [ins.id, ins.name, ins.category, ins.waveform, JSON.stringify(ins.config)]
  );
  console.log('Instrument:', ins.id);
}

for (const song of songs) {
  const totalSteps = song.tempo;
  const melodyInstrument = song.instrument_ids[0];
  const bassInstrument = song.instrument_ids[1] || song.instrument_ids[0];
  const channels = [
    tile(song.melody, totalSteps).map(note => note ? { note, instrument: melodyInstrument, vol: 1 } : null),
    tile(song.bass, totalSteps).map(note => note ? { note, instrument: bassInstrument, vol: 0.8 } : null),
  ];
  await query(
    `INSERT INTO audio_songs (id, name, category, tempo, channels, loop_start, loop_end, instrument_ids, priority, enabled)
     VALUES ($1,$2,$3,$4,$5,0,0,$6,5,1)
     ON CONFLICT (id) DO UPDATE SET name=$2, category=$3, tempo=$4, channels=$5, instrument_ids=$6`,
    [song.id, song.name, song.category, song.tempo, JSON.stringify(channels), JSON.stringify(song.instrument_ids)]
  );
  console.log('Song:', song.name, `(${totalSteps} steps @ ${song.tempo}bpm = 15s)`);
}

console.log('Done.');
process.exit(0);
