// "The Inbetween": the background loop for zone_the_inbetween, the place off the map before the
// vat. Four instruments only: a soft kit, a quiet bass, the bell-like e-piano with the tune, and
// an electric guitar riffing on it. Mixed low: the attendant's voice and the room sit on top.
//
//   node scripts/content/build-inbetween.mjs           write the song and its guitar
//   node scripts/content/build-inbetween.mjs --check   fail if the files are behind this script
//   node scripts/audio/song-lint.mjs --module scripts/content/build-inbetween.mjs
//   node scripts/audio/song-render.mjs --module scripts/content/build-inbetween.mjs --wav x.wav
//
// E minor, 88 bpm, 24 bars (about 65 s), loops whole. Em C Am B, two bars a chord.
//   1-8    the bell plays the tune over kick, hats and the bass
//   9-16   the guitar riffs on the tune, the bell answers with held notes, the snare comes in
//   17-24  the bell and the guitar together, the kit thins out, a soft tom walk back to bar 1
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import { instruments as LOOP_INSTRUMENTS } from './build-ambient-loops.mjs';
import { Song, chord, rng, midi, HAT_ACCENT } from '../audio/compose-lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

const env = (a, d, s, r, curve) => ({ a, d, s, r, ...(curve ? { curve } : {}) });
const lp = (freq, q = 0.7) => ({ type: 'lowpass', freq, q });
const vib = (id, rate, cents, fade) => ({ id, type: 'lfo', wave: 'sine', rate, fade, to: [{ param: 'pitch', amount: cents }] });

// The guitar: a saw through a gentle tube clip, a second a little sharp, a dark cabinet and
// vibrato that comes in late. Overdriven, not fuzzed: it should sit behind talk.
const GTR = {
  id: 'aud_inst_inbetween_glead', name: 'Inbetween: Electric guitar', category: 'loops', waveform: 'sawtooth', enabled: 1, sample_id: null,
  config: { layers: [
    { waveform: 'sawtooth', gain: 0.012, adsr: env(0.004, 0.35, 0.7, 0.25), drive: 0.55, driveType: 'tube', filter: lp(2400, 1.6), mods: [vib('vb', 5.3, 14, 0.35)] },
    { waveform: 'sawtooth', detune: 7, gain: 0.007, adsr: env(0.004, 0.35, 0.65, 0.25), drive: 0.5, driveType: 'tube', filter: lp(2100, 1.2), mods: [vib('vb', 5, 12, 0.4)] },
  ] },
};
const INST_ID = (k) => (k === 'gtr' ? GTR.id : `aud_inst_loop_${k}`);
export const instruments = [...LOOP_INSTRUMENTS, GTR];

const KICK = 'C2', SNARE = 'D3', HAT = 'C5';
const KIT = {
  A: { kick: 'X.......X.......', hat: 'x...x...x...x...' },
  B: { kick: 'X.........X.....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.' },
  C: { kick: 'X...............', snare: '........X.......', hat: 'x...x...x...x...' },
};
const CHORDS = ['Em', 'C', 'Am', 'B'];
// The tune: a held note, a step up, a fall that lands a bar early.
const THEME = [
  'E5:6 F#5:2 G5:4 F#5:4 | E5:4 D5:4 B4:8',
  'E5:6 F#5:2 G5:4 A5:4 | G5:4 E5:4 C5:8',
  'A5:6 G5:2 F#5:4 E5:4 | C5:4 D5:4 E5:8',
  'D#5:6 E5:2 F#5:4 B4:4 | D#5:8 F#5:8',
];
// The guitar's riff: the tune an octave down, its opening note split into a 3-3-2 push.
const RIFF = [
  'E4:3 E4:3 F#4:2 G4:4 F#4:4 | E4:2 D4:2 E4:4 B3:8',
  'E4:3 E4:3 F#4:2 G4:4 A4:4 | G4:2 E4:2 G4:4 C4:8',
  'A4:3 A4:3 G4:2 F#4:4 E4:4 | C4:2 D4:2 E4:4 A3:8',
  'D#4:3 D#4:3 E4:2 F#4:4 B3:4 | D#4:4 F#4:4 B4:8',
];
// the bell's answer while the guitar has the tune: one held note a bar
const HELD = ['G5:16 | B4:16', 'G5:16 | E5:16', 'C6:16 | A5:16', 'F#5:16 | D#5:16'];

function compose(seed) {
  const r = rng(seed);
  const song = new Song({ name: 'inbetween', tempo: 88, bars: 24, swing: 0.52, master: 0.5 });
  const P = {
    bell: song.part('bell', 'epiano', { pan: 0.2 }),
    gtr: song.part('gtr', 'gtr', { pan: -0.25 }),
    bass: song.part('bass', 'fmbass', { pan: 0 }),
    kick: song.part('kick', 'kick', { pan: 0 }),
    snare: song.part('snare', 'snare', { pan: 0 }),
    hat: song.part('hat', 'hat', { pan: 0.3 }),
    tom: song.part('tom', 'tom', { pan: -0.2 }),
  };
  for (const [bar0, sec] of [[1, 'A'], [9, 'B'], [17, 'C']]) {
    CHORDS.map(chord).forEach((ch, c) => {
      const bar = bar0 + c * 2;
      // the tune and the riff
      if (sec === 'A' || sec === 'C') P.bell.line(bar, THEME[c], sec === 'A' ? 0.6 : 0.5);
      if (sec === 'B') P.bell.line(bar, HELD[c], 0.4);
      if (sec === 'B' || sec === 'C') P.gtr.line(bar, RIFF[c], sec === 'B' ? 0.62 : 0.52);
      // the bass: quiet, a root and its octave off the beat
      let low = midi('E2') + ((ch.bass - 4 + 12) % 12);
      if (low > midi('B2')) low -= 12;
      for (let b = 0; b < 2; b++) for (const [row, d, len] of [[0, 0, 3], [6, 0, 2], [10, 12, 1], [12, 0, 3]]) P.bass.note(bar + b, row, low + d, len, row === 0 ? 0.42 : 0.32);
      // the kit
      const kit = KIT[sec];
      for (let b = 0; b < 2; b++) {
        P.kick.hits(bar + b, kit.kick, KICK, { scale: 0.6 });
        if (kit.snare) P.snare.hits(bar + b, kit.snare, SNARE, { scale: 0.5 });
        P.hat.hits(bar + b, kit.hat, HAT, { scale: 0.38, accent: HAT_ACCENT });
      }
    });
  }
  // a soft tom walk into the guitar's section and back round to bar 1
  for (const bar of [8, 24]) [[10, 'E3'], [12, 'D3'], [14, 'A2']].forEach(([row, n], k) => P.tom.note(bar, row, n, 1, 0.32 + 0.04 * k));
  for (const [k, p] of Object.entries(P)) p.humanize(r, { vel: k === 'hat' ? 0.1 : 0.05 });
  return song.toSong('song_inbetween', { instrumentId: INST_ID, category: 'ambient', priority: 3, loopStart: 0 });
}

export const song = compose('the inbetween');
export const songs = [song];
song.channels.forEach((c, k) => c.forEach((st, i) => { if (st && i + (st.len || 1) > c.length) throw new Error(`${song.name} ch ${k}: ${st.note} at ${i} runs past the end`); }));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let behind = false;
  for (const [rel, row] of [[`content/audio_instruments/${GTR.id}.json`, GTR], [`content/audio_songs/${song.id}.json`, song]]) {
    const p = path.join(ROOT, rel), want = canonicalJson(row);
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === want) continue;
    if (CHECK) { console.error(`✗ ${rel} is behind scripts/content/build-inbetween.mjs`); behind = true; continue; }
    fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`);
  }
  if (behind) process.exit(1);
  console.log(`✓ ${song.name}: ${song.channels.length} channels, 24 bars at ${song.tempo} bpm (${(24 * 4 * 60 / song.tempo).toFixed(0)} s), loops whole`);
}
