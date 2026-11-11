// The sponsor jingles: four short tracker songs, one under each advert's animated logo.
//
//   node scripts/content/build-ad-jingles.mjs           write the instrument and song files
//   node scripts/content/build-ad-jingles.mjs --check   fail if the files are behind this script
//
// Each plays once from the advert's `music` node, right after its title card
// (data/scripts/acidcola.bsm, sleepright.bsm, hungryman.bsm, and the Rosenberg break in
// youre_not_gonna_believe_this_shit.bsm). scripts/audio/song-render.mjs renders one to a WAV;
// scripts/audio/song-lint.mjs --module this file reads them.
//
//   acid_cola_jingle   128 bpm, C major. A can opens, a bright four-bar hook in square lead
//                      and brass, and the last chord sours: C with a D♭ on top. Reality hurts.
//   corporate_chime    SleepRight. 72 bpm, E♭ major. Bells and a pad, the three-note
//                      "wake bet-ter" chime (G B♭ E♭), and a last bell held a beat too long.
//   just_meats_jingle  Hungry Man. 96 bpm. One bass note, E, the whole way through, grunts
//                      on the off-beats, and three brass stabs on that same E at the end.
//   rosenberg_jingle   Jerry Rosenberg, family law. 88 bpm, D minor, swung: electric piano
//                      on ii-V-i, a walking bass, brushes, and a sax line that lands on the
//                      major third. A divorce, sold as a fresh start.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import { Song, rng } from '../audio/compose-lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

// ── instruments ─────────────────────────────────────────────────────────────
const env = (a, d, s, r, curve) => ({ a, d, s, r, ...(curve ? { curve } : {}) });
const lp = (freq, q = 0.8) => ({ type: 'lowpass', freq, q });
const bp = (freq, q = 0.8) => ({ type: 'bandpass', freq, q });
const hp = (freq, q = 0.7) => ({ type: 'highpass', freq, q });
const vib = (id, rate, cents, fade) => ({ id, type: 'lfo', wave: 'sine', rate, fade, to: [{ param: 'pitch', amount: cents }] });
const drop = (id, cents, d) => ({ id, type: 'env', a: 0.001, d, s: 0, r: 0.05, to: [{ param: 'pitch', amount: cents }] });
const sweep = (id, cents, a, d, s) => ({ id, type: 'env', a, d, s, r: 0.2, to: [{ param: 'filter.cutoff', amount: cents }] });

const INSTRUMENTS = {
  lead: { name: 'Ad: Square lead', waveform: 'square', layers: [
    { gain: 0.13, adsr: env(0.005, 0.12, 0.7, 0.1), filter: lp(3200, 0.9), mods: [vib('vb', 5.5, 12, 0.25)],
      echo: { mix: 0.15, delay: 0.17, feedback: 0.3 } },
    { waveform: 'sawtooth', detune: 7, gain: 0.06, adsr: env(0.005, 0.12, 0.6, 0.1), filter: lp(2400, 0.7) },
  ] },
  brass: { name: 'Ad: Brass stab', waveform: 'sawtooth', layers: [
    { gain: 0.16, adsr: env(0.015, 0.2, 0.55, 0.14), filter: lp(1200, 1.0), mods: [sweep('bl', 2400, 0.02, 0.18, 0.4), drop('sc', -30, 0.05)] },
    { detune: -8, gain: 0.12, adsr: env(0.02, 0.2, 0.5, 0.14), filter: lp(1500, 0.8) },
  ] },
  bell: { name: 'Ad: Glass bell', waveform: 'sine', layers: [
    { gain: 0.2, adsr: env(0.002, 2.2, 0, 1.2, 'exp'), fm: { ratio: 3.5, index: 2.2, indexEnd: 0.2, time: 0.6 },
      echo: { mix: 0.3, delay: 0.28, feedback: 0.35 } },
    { gain: 0.07, adsr: env(0.002, 1.2, 0, 0.8, 'exp'), fm: { ratio: 7.1, index: 1.2, indexEnd: 0, time: 0.3 } },
  ] },
  pad: { name: 'Ad: Soft pad', waveform: 'sawtooth', layers: [
    { detune: -9, gain: 0.07, adsr: env(0.6, 0.5, 0.8, 1.2), filter: lp(900, 0.6) },
    { detune: 9, gain: 0.07, adsr: env(0.7, 0.5, 0.8, 1.2), filter: lp(1000, 0.6) },
    { waveform: 'triangle', gain: 0.06, adsr: env(0.5, 0.4, 0.9, 1.0) },
  ] },
  bass: { name: 'Ad: Synth bass', waveform: 'square', layers: [
    { gain: 0.2, adsr: env(0.004, 0.25, 0.5, 0.08), filter: lp(500, 1.2), mods: [sweep('pl', 1500, 0.003, 0.12, 0)] },
    { waveform: 'sine', gain: 0.18, adsr: env(0.004, 0.3, 0.6, 0.08) },
  ] },
  upright: { name: 'Ad: Upright bass', waveform: 'triangle', layers: [
    { gain: 0.26, adsr: env(0.006, 0.5, 0.25, 0.12, 'exp'), filter: lp(700, 0.8), mods: [drop('th', 25, 0.04)] },
    { noiseMix: 1, gain: 0.03, adsr: env(0.001, 0.03, 0, 0.02, 'exp'), filter: bp(1200, 1.0), noiseSeed: 5 },
  ] },
  epiano: { name: 'Ad: Electric piano', waveform: 'sine', layers: [
    { gain: 0.16, adsr: env(0.003, 1.4, 0.2, 0.4, 'exp'), fm: { ratio: 14, index: 1.4, indexEnd: 0, time: 0.08 },
      mods: [{ id: 'tr', type: 'lfo', wave: 'sine', rate: 4.5, to: [{ param: 'gain', amount: 0.25 }] }] },
    { gain: 0.1, adsr: env(0.003, 1.0, 0.25, 0.4, 'exp'), fm: { ratio: 2, index: 0.6, indexEnd: 0.1, time: 0.5 } },
  ] },
  sax: { name: 'Ad: Lounge sax', waveform: 'sawtooth', layers: [
    { gain: 0.13, adsr: env(0.04, 0.2, 0.75, 0.18), filter: bp(1100, 1.4), mods: [vib('vb', 5, 18, 0.35), drop('sc', -60, 0.08)],
      echo: { mix: 0.18, delay: 0.22, feedback: 0.3 } },
    { noiseMix: 1, gain: 0.025, adsr: env(0.03, 0.2, 0.5, 0.15), filter: bp(2600, 2.0), noiseSeed: 41 },
  ] },
  grunt: { name: 'Ad: Grunt', waveform: 'sawtooth', layers: [
    { gain: 0.22, adsr: env(0.01, 0.16, 0, 0.06, 'exp'), filter: bp(520, 3.0), mods: [drop('gd', -400, 0.15)] },
    { noiseMix: 1, gain: 0.06, adsr: env(0.005, 0.1, 0, 0.05, 'exp'), filter: bp(800, 1.5), noiseSeed: 3 },
  ] },
  kick: { name: 'Ad: Kick', waveform: 'sine', layers: [
    { gain: 0.42, adsr: env(0.001, 0.32, 0, 0.1, 'exp'), mods: [drop('kd', 1900, 0.05)] },
  ] },
  snare: { name: 'Ad: Snare', waveform: 'triangle', layers: [
    { gain: 0.12, adsr: env(0.001, 0.09, 0, 0.05, 'exp'), mods: [drop('sd', 500, 0.03)] },
    { noiseMix: 1, gain: 0.2, adsr: env(0.001, 0.16, 0, 0.08, 'exp'), filter: hp(1500, 0.7), noiseSeed: 17 },
  ] },
  hat: { name: 'Ad: Hi-hat', waveform: 'square', layers: [
    { noiseMix: 1, gain: 0.09, adsr: env(0.0005, 0.04, 0, 0.03, 'exp'), filter: hp(7000, 0.8), noiseSeed: 29 },
  ] },
  brush: { name: 'Ad: Brushes', waveform: 'square', layers: [
    { noiseMix: 1, gain: 0.08, adsr: env(0.01, 0.14, 0, 0.08), filter: bp(4200, 0.6), noiseSeed: 31 },
  ] },
  fizz: { name: 'Ad: Can fizz', waveform: 'square', layers: [
    { noiseMix: 1, gain: 0.22, adsr: env(0.001, 0.05, 0, 0.03, 'exp'), filter: bp(2500, 1.2), noiseSeed: 61 },
    { noiseMix: 1, gain: 0.1, adsr: env(0.02, 1.4, 0, 0.4), filter: hp(5000, 0.7), noiseSeed: 67 },
  ] },
};
const INST_ID = (key) => `aud_inst_ad_${key}`;

// ── the songs ───────────────────────────────────────────────────────────────
function acidCola() {
  const s = new Song({ name: 'acid_cola_jingle', tempo: 128, bars: 6, master: 0.85 });
  const lead = s.part('lead', 'lead', { pan: 0.15 });
  const brass = s.part('brass', 'brass', { pan: -0.2 });
  const bass = s.part('bass', 'bass');
  const kick = s.part('kick', 'kick'), snare = s.part('snare', 'snare', { pan: 0.05 });
  const hat = s.part('hat', 'hat', { pan: 0.3 }), fizz = s.part('fizz', 'fizz', { pan: -0.1 });
  fizz.note(1, 0, 'C5', 12, 0.9);                                   // the can opens
  lead.line(1, 'r:8 G5:2 A5:2 B5:2 C6:2 | E6:3 D6:3 C6:2 G5:4 E5:4 | F5:3 G5:3 A5:2 C6:4 A5:4 | G5:6 E5:2 D5:4 C5:4');
  lead.line(5, 'E6:2 E6:2 G6:4 E6:4 C6:4 | C6:16', 0.85);
  brass.line(2, 'C5:2 r:6 C5:2 r:6 | F4:2 r:6 F4:2 r:6 | G4:2 r:6 G4:2 r:6', 0.7);
  brass.line(5, 'G4:2 r:2 G4:2 r:2 G4:4 r:4 | C5:4 r:2 Db6:10', 0.85);  // the sour note on top
  bass.line(2, 'C2:3 C2:3 C3:2 C2:4 G2:4 | F2:3 F2:3 F3:2 F2:4 A2:4 | G2:3 G2:3 G3:2 G2:4 B2:4 | G2:3 G2:3 G3:2 G2:8 | C2:16');
  for (let b = 2; b <= 5; b++) {
    kick.hits(b, 'X...x...X...x...', 'C2');
    snare.hits(b, '....X.......X..o', 'D3');
    hat.hits(b, '..x...x...x...x.', 'F#5');
  }
  kick.hits(6, 'X...............', 'C2');
  return s;
}

function sleepRight() {
  const s = new Song({ name: 'corporate_chime', tempo: 72, bars: 5, master: 0.8 });
  const bell = s.part('bell', 'bell', { pan: 0.2 });
  const pad = s.part('pad', 'pad', { pan: -0.15 }), pad2 = s.part('pad2', 'pad', { pan: 0.15 });
  const bass = s.part('bass', 'bass');
  bell.line(1, 'G5:4 Bb5:4 Eb6:8 | Eb6:4 F6:4 G6:4 Bb5:4 | Ab5:4 G5:4 F5:8 | G5:4 Bb5:4 Eb6:4 r:4 | Eb6:16', 0.75);
  pad.line(1, 'Eb4:16 | Eb4:16 | C4:16 | D4:16 | Eb4:16', 0.6);
  pad2.line(1, 'G4:16 | Bb4:16 | Ab4:16 | Bb4:16 | G4:16', 0.6);
  bass.line(1, 'Eb2:16 | G2:16 | Ab2:16 | Bb2:16 | Eb2:16', 0.5);
  return s;
}

function hungryMan() {
  const s = new Song({ name: 'just_meats_jingle', tempo: 96, bars: 6, master: 0.85 });
  const bass = s.part('bass', 'bass'), grunt = s.part('grunt', 'grunt', { pan: 0.1 });
  const brass = s.part('brass', 'brass', { pan: -0.15 }), kick = s.part('kick', 'kick'), snare = s.part('snare', 'snare');
  for (let b = 1; b <= 5; b++) {
    bass.line(b, 'E2:4 E2:4 E2:4 E2:4', b === 5 ? 0.9 : 0.75);
    kick.hits(b, 'X.......X.......', 'C2');
    if (b > 1) snare.hits(b, '....X.......X...', 'D3');
    grunt.line(b, b < 5 ? 'r:2 E3:2 r:4 r:2 E3:2 r:2 E3:2' : 'r:2 E3:2 r:2 E3:2 r:2 E3:2 r:2 E3:2', 0.8);
  }
  brass.line(5, 'r:8 E4:2 r:2 E4:2 r:2');
  brass.line(6, 'E4:12 r:4', 0.95);
  bass.line(6, 'E2:12 r:4', 0.9);
  kick.hits(6, 'X...............', 'C2');
  return s;
}

function rosenberg() {
  const s = new Song({ name: 'rosenberg_jingle', tempo: 88, bars: 6, master: 0.8, swing: 0.6 });
  const ep1 = s.part('ep1', 'epiano', { pan: -0.2 }), ep2 = s.part('ep2', 'epiano', { pan: 0.2 }), ep3 = s.part('ep3', 'epiano');
  const bass = s.part('bass', 'upright'), sax = s.part('sax', 'sax', { pan: 0.1 }), brush = s.part('brush', 'brush', { pan: 0.25 });
  // ii-V-i in D minor twice, then the turn to D major for the button
  const chords = [['E4', 'G4', 'Bb4'], ['F4', 'A4', 'C#5'], ['F4', 'A4', 'C5'], ['E4', 'G4', 'Bb4'], ['F4', 'A4', 'C#5'], ['F#4', 'A4', 'D5']];
  chords.forEach(([a, b, c], i) => {
    const bar = i + 1;
    ep1.line(bar, `${a}:6 ${a}:10`, 0.55); ep2.line(bar, `${b}:6 ${b}:10`, 0.5); ep3.line(bar, `${c}:6 ${c}:10`, 0.5);
    brush.hits(bar, 'x..o x..o x..o x..o', 'C4');
  });
  bass.line(1, 'E2:4 G2:4 A2:4 C#3:4 | A2:4 C#3:4 E3:4 A2:4 | D2:4 F2:4 A2:4 D3:4 | E2:4 G2:4 A2:4 C#3:4 | A2:4 E2:4 C#2:4 A1:4 | D2:16', 0.75);
  sax.line(1, 'r:4 A4:2 Bb4:2 A4:4 G4:4 | F4:2 E4:2 F4:2 G4:2 A4:8 | D5:4 C5:2 A4:2 F4:4 D4:4 | r:4 A4:2 Bb4:2 A4:4 G4:4 | F4:2 G4:2 A4:2 C5:2 E5:8 | F#5:16', 0.7);
  return s;
}

// Hands on every pitched and drum channel: a seeded ±8% on the weak rows, so nothing is one level.
const human = (s, seed) => { const r = rng(seed); for (const p of s.parts) p.humanize(r, { vel: 0.12 }); return s; };
const SONGS = [human(acidCola(), 11), human(sleepRight(), 12), human(hungryMan(), 13), human(rosenberg(), 14)];

export const songs = SONGS.map((s) => {
  const row = s.toSong(`aud_song_${s.name}`, { instrumentId: INST_ID, category: 'commercial', priority: 5, loopStart: 0, loopEnd: 0 });
  for (const ch of row.channels) ch.forEach((st, i) => { if (st && i + (st.len || 1) > s.rows) throw new Error(`${s.name}: note runs past the end at row ${i}`); });
  row.instrument_ids.sort();
  return row;
});
const used = new Set(songs.flatMap((r) => r.instrument_ids));
export const instruments = Object.entries(INSTRUMENTS).filter(([k]) => used.has(INST_ID(k))).map(([key, def]) => ({
  id: INST_ID(key), name: def.name, category: 'commercial', waveform: def.waveform, enabled: 1, sample_id: null,
  config: { layers: def.layers.map((l) => ({ waveform: def.waveform, ...l })) },
}));

// ── write ───────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = [
    ...instruments.map((r) => [`content/audio_instruments/${r.id}.json`, r]),
    ...songs.map((r) => [`content/audio_songs/${r.id}.json`, r]),
  ];
  let stale = 0;
  for (const [rel, row] of files) {
    const p = path.join(ROOT, rel);
    const want = canonicalJson(row);
    const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (have === want) continue;
    stale++;
    if (CHECK) console.error(`✗ ${rel} is behind scripts/content/build-ad-jingles.mjs`);
    else { fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`); }
  }
  if (CHECK && stale) process.exit(1);
  for (const s of SONGS) console.log(`${CHECK ? '✓ up to date' : '✓ built'}: ${s.name}, ${s.bars} bars at ${s.tempo} bpm (${(s.rows * 60 / s.tempo / 4).toFixed(1)} s)`);
}
