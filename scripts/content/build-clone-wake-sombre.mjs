// "Clone Wake (Sombre)": the slow, sad sibling of build-clone-wake.mjs, kept as its own song
// (song_clone_wake_sombre) so either can be the clone facility's theme.
//
//   node scripts/content/build-clone-wake-sombre.mjs           write the song file
//   node scripts/content/build-clone-wake-sombre.mjs --check   fail if the file is behind this script
//   node scripts/audio/song-lint.mjs --module scripts/content/build-clone-wake-sombre.mjs
//   node scripts/audio/song-render.mjs clone_wake_sombre --wav clone_wake_sombre.wav
//
// C minor, 88 bpm, 32 bars, i-VI-iv-V (Cm Ab Fm G): the major V pulls back to the minor every
// time, which is most of the sadness. No four-on-the-floor; the drums stay half time throughout.
//   1-8    pads alone, then a slow e-piano arp and a held bass
//   9-16   the tune on the FM e-piano, a sighing figure that falls by step, over a soft half-time kit
//   17-24  the same tune on the hook lead with its echo, the pad pumping, the bass moving
//   25-32  the tune goes quiet: held e-piano notes over the pads, the kick alone, the bass held,
//          ending on G to lean back into bar 9
// The loop starts at bar 9. It reuses the loop palette and Clone Wake's hook lead.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import { instruments } from './build-clone-wake.mjs';
import { Song, chord, voiceLead, rng, midi, HAT_ACCENT } from '../audio/compose-lib.mjs';
export { instruments };

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');
const INST_ID = (k) => (k === 'hook' ? 'aud_inst_clonewake_hook' : `aud_inst_loop_${k}`);

const KICK = 'C2', SNARE = 'D3', HAT = 'C5';
const HALF = { kick: 'X.........X.....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.' };
const CHORDS = ['Cm', 'Ab', 'Fm', 'G'];
// A sigh: a held note, a step up and back, a fall by step that rests a bar. One rhythm, sequenced.
const TUNE = [
  'G4:6 Ab4:2 G4:4 Eb4:4 | F4:4 Eb4:4 D4:8',
  'Eb5:6 F5:2 Eb5:4 C5:4 | D5:4 C5:4 Ab4:8',
  'C5:6 D5:2 C5:4 Ab4:4 | G4:4 Ab4:4 F4:8',
  'D5:6 Eb5:2 D5:4 B4:4 | C5:4 B4:4 G4:8',
];
// the last section: the tune thinned to its held notes
const HELD = ['G4:16 | Eb4:16', 'C5:16 | Ab4:16', 'Ab4:16 | F4:16', 'B4:16 | D5:16'];

function compose(seed) {
  const r = rng(seed);
  const song = new Song({ name: 'clone_wake_sombre', tempo: 88, bars: 32, swing: 0.5, key: { flats: true }, master: 0.68 });
  const P = {
    lead: song.part('lead', 'epiano', { pan: 0.05 }),
    echo: song.part('echo', 'hook', { pan: 0.4 }),
    arp: song.part('arp', 'epiano', { pan: -0.35 }),
    pad: [song.part('pad1', 'pad', { pan: -0.35 }), song.part('pad2', 'pad', { pan: 0 }), song.part('pad3', 'pad', { pan: 0.35 })],
    bass: song.part('bass', 'fmbass', { pan: 0 }),
    kick: song.part('kick', 'kick', { pan: 0 }),
    snare: song.part('snare', 'snare', { pan: 0 }),
    tom: song.part('tom', 'tom', { pan: -0.2 }),
    hat: song.part('hat', 'hat', { pan: 0.3 }),
  };
  let voicing = null;
  const lowRoot = (ch) => { const m = midi('C2') + ch.bass % 12; return m > midi('G2') ? m - 12 : m; };

  for (const [bar0, sec] of [[1, 'intro'], [9, 'A'], [17, 'B'], [25, 'out']]) {
    CHORDS.map(chord).forEach((ch, c) => {
      const bar = bar0 + c * 2;
      voicing = voiceLead(ch, voicing, { lo: 'G3', hi: 'E5', n: 3 });
      // pads: held two bars, except B, where they pump softly on the beat
      if (sec === 'B') for (let q = 0; q < 8; q++) voicing.forEach((m, v) => P.pad[v].note(bar + (q >> 2), (q & 3) * 4, m, 4, q % 4 ? 0.5 : 0.58, { instrument: 'pump' }));
      else voicing.forEach((m, v) => P.pad[v].note(bar, 0, m, 32, sec === 'intro' ? 0.38 + 0.05 * c : 0.5));
      // the e-piano arp: eighths, from the second half of the intro on, gone in the outro
      if ((sec === 'intro' && c >= 2) || sec === 'A' || sec === 'B') P.arp.arp(bar, 0, ch, { rows: 32, rate: 2, shape: 'updown', lo: 'G4', octaves: 1, vol: sec === 'intro' ? 0.3 : 0.38 });
      // bass: held roots in the intro and outro, a slow octave figure in A and B
      const low = lowRoot(ch);
      if (sec === 'intro' || sec === 'out') { if (sec === 'out' || c >= 2) P.bass.note(bar, 0, low, 32, 0.6); }
      else for (let b = 0; b < 2; b++) for (const [row, m, len] of [[0, low, 5], [6, low + 12, 1], [8, low, 3], [12, low + (sec === 'B' ? 7 : 12), 3]]) P.bass.note(bar + b, row, m, len, row === 0 ? 0.85 : 0.65);
      // the tune
      if (sec === 'A') P.lead.line(bar, TUNE[c], 0.75);
      if (sec === 'B') P.lead.line(bar, TUNE[c], 0.7).rows.forEach((s, i) => { if (s && i >= P.lead.at(bar, 0) && i < P.lead.at(bar + 2, 0)) s.instrument = 'hook'; });
      if (sec === 'out') P.lead.line(bar, HELD[c], 0.55);
      // drums: half time, the snare only in B, hats soft
      for (let b = 0; b < 2; b++) {
        const at = bar + b;
        if (sec === 'intro') continue;
        P.kick.hits(at, HALF.kick, KICK, { scale: sec === 'out' ? 0.6 : 0.8 });
        if (sec === 'B') P.snare.hits(at, HALF.snare, SNARE, { scale: 0.65 });
        if (sec !== 'out') P.hat.hits(at, HALF.hat, HAT, { scale: 0.45, accent: HAT_ACCENT });
      }
    });
  }
  // a quiet tom walk down into the tune at the end of the intro and of A
  for (const bar of [8, 16]) [[8, 'G3'], [12, 'D3'], [14, 'A2']].forEach(([row, n], k) => P.tom.note(bar, row, n, 1, 0.4 + 0.05 * k));
  // the echo follows the hook lead in B only
  P.echo.echoOf(P.lead, { rows: 3, vol: 0.4, wrap: false });
  P.echo.clear(1, 16).clear(25, 32);
  for (const [k, p] of Object.entries(P)) for (const part of Array.isArray(p) ? p : [p]) part.humanize(r, { vel: k === 'hat' ? 0.1 : 0.05 });
  return song.toSong('song_clone_wake_sombre', { instrumentId: INST_ID, category: 'ambient', priority: 4, loopStart: 8 * 16 });
}

export const songs = [compose('clone wake sombre')];
for (const s of songs) s.channels.forEach((c, k) => c.forEach((st, i) => { if (st && i + (st.len || 1) > c.length) throw new Error(`${s.name} ch ${k}: ${st.note} at ${i} runs past the end`); }));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const s = songs[0], rel = `content/audio_songs/${s.id}.json`, p = path.join(ROOT, rel), want = canonicalJson(s);
  const same = fs.existsSync(p) && fs.readFileSync(p, 'utf8') === want;
  if (CHECK && !same) { console.error(`✗ ${rel} is behind scripts/content/build-clone-wake-sombre.mjs`); process.exit(1); }
  if (!same && !CHECK) { fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`); }
  console.log(`✓ ${s.name}: ${s.channels.length} channels, 32 bars at ${s.tempo} bpm (${(32 * 4 * 60 / s.tempo).toFixed(0)} s), loops from bar 9`);
}
