// "Clone Wake": the theme for the Coldwater Clone Facility (zone_start), the room every new
// body opens its eyes in. House style (docs/reference/game-music-craft.md#house-style-80s-synth-dance),
// but built like a single rather than a loop: the pads build, the drop hits, and a bright lead
// comes through with a written hook.
//
//   node scripts/content/build-clone-wake.mjs           write the instrument and song files
//   node scripts/content/build-clone-wake.mjs --check   fail if the files are behind this script
//   node scripts/audio/song-lint.mjs --module scripts/content/build-clone-wake.mjs
//   node scripts/audio/song-render.mjs clone_wake --wav clone_wake.wav
//
// F minor, 112 bpm, 40 bars:
//   1-8    the build: pads alone, then the arp and a held bass, sixteenth hats, a snare roll and
//          climbing toms into a half beat of silence
//   9-24   the drop: four on the floor, octave bass, pumping pad, the hook twice (the second
//          time it climbs out), its echo a dotted eighth behind
//   25-32  the breakdown: Bbm Db Eb C, half time, brass stabs, the lead held long, leaning on
//          harmonic minor's C major into the drop
//   33-40  the drop again with the clap and a galloping bass
// The loop starts at bar 9, so the build plays once when you wake and the drop is what repeats.
// The hook is hand-written, not drawn from motif(): one 3-3-2 rhythm sequenced down the chords.
// It reuses the loop palette (build-ambient-loops.mjs) and adds one instrument, the hook lead.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import { instruments as LOOP_INSTRUMENTS } from './build-ambient-loops.mjs';
import { Song, chord, voiceLead, rng, midi, HAT_ACCENT } from '../audio/compose-lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

const env = (a, d, s, r, curve) => ({ a, d, s, r, ...(curve ? { curve } : {}) });
const lp = (freq, q = 0.7) => ({ type: 'lowpass', freq, q });
const vib = (id, rate, cents, fade) => ({ id, type: 'lfo', wave: 'sine', rate, fade, to: [{ param: 'pitch', amount: cents }] });
const cut = (id, cents, d, s = 0) => ({ id, type: 'env', a: 0.001, d, s, r: 0.08, curve: 'exp', to: [{ param: 'filter.cutoff', amount: cents }] });

// The hook lead: two saws wide apart and a square an octave up, the filter snapping open on each
// note and a bright FM edge on top, so it sits over the pumping pad instead of inside it.
const HOOK = {
  id: 'aud_inst_clonewake_hook', name: 'Clone Wake: Hook lead', category: 'loops', waveform: 'sawtooth', enabled: 1, sample_id: null,
  config: { layers: [
    { waveform: 'sawtooth', detune: -12, gain: 0.12, adsr: env(0.004, 0.18, 0.7, 0.22), filter: lp(2200, 2.2),
      mods: [cut('bl', 2600, 0.16, 0.35), vib('vb', 5.6, 16, 0.35)] },
    { waveform: 'sawtooth', detune: 12, gain: 0.12, adsr: env(0.004, 0.18, 0.7, 0.22), filter: lp(2400, 1.8),
      mods: [cut('bl', 2400, 0.17, 0.35), vib('vb', 5.3, 14, 0.4)] },
    { waveform: 'square', tune: 12, gain: 0.045, adsr: env(0.003, 0.15, 0.55, 0.2), filter: lp(4200, 0.9) },
    { waveform: 'sine', tune: 12, gain: 0.04, adsr: env(0.002, 0.12, 0.2, 0.15, 'exp'),
      fm: { ratio: 3, index: 2.2, indexEnd: 0.4, time: 0.12, bright: 1.5 } },
  ] },
};
const INST_ID = (k) => (k === 'hook' ? HOOK.id : `aud_inst_loop_${k}`);
export const instruments = [...LOOP_INSTRUMENTS, HOOK];

const KICK = 'C2', SNARE = 'D3', HAT = 'C5';
const FOUR = { kick: 'X...X...X...X...', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', ohat: '..x...x...x...x.' };
const HALF = { kick: 'X.........X.....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.' };
const DROP = ['Fm', 'Db', 'Ab', 'Eb'];
const BREAK = ['Bbm', 'Db', 'Eb', 'C'];

// The hook, two bars a chord. Same 3-3-2 rhythm each time, the shape sequenced down the chords.
const HOOK_A = [
  'C5:3 C5:3 Ab4:2 C5:2 Db5:2 C5:4 | r:2 Bb4:2 Ab4:2 F4:2 Ab4:8',
  'Ab4:3 Ab4:3 F4:2 Ab4:2 Bb4:2 Ab4:4 | r:2 Ab4:2 C5:2 Db5:2 C5:8',
  'Eb5:3 Eb5:3 C5:2 Eb5:2 F5:2 Eb5:4 | r:2 Db5:2 C5:2 Ab4:2 C5:8',
  'Bb4:3 Bb4:3 G4:2 Bb4:2 C5:2 Bb4:4 | r:2 Eb5:2 Db5:2 C5:2 Bb4:4 G4:4',
];
// the second time round the last two bars climb out instead of settling
const HOOK_LIFT = 'Bb4:3 Bb4:3 G4:2 Bb4:2 C5:2 Bb4:4 | r:2 Bb4:2 C5:2 Db5:2 Eb5:4 G5:4';
// the third time (bars 33-40) the first answer jumps up to F5
const HOOK_HIGH = 'C5:3 C5:3 Ab4:2 C5:2 Db5:2 C5:4 | r:2 Db5:2 Eb5:2 F5:2 C5:8';
const BREAK_LEAD = [
  'Db5:12 C5:2 Bb4:2 | Db5:16',
  'F5:12 Eb5:2 Db5:2 | Ab4:16',
  'G5:12 F5:2 Eb5:2 | Bb4:16',
  'C5:8 E5:8 | G5:12 r:4',
];

function compose(seed) {
  const r = rng(seed);
  const song = new Song({ name: 'clone_wake', tempo: 112, bars: 40, swing: 0.5, key: { flats: true }, master: 0.72 });
  const P = {
    lead: song.part('lead', 'hook', { pan: 0.05 }),
    echo: song.part('echo', 'hook', { pan: 0.4 }),
    arp: song.part('arp', 'arp', { pan: -0.35 }),
    pad: [song.part('pad1', 'pad', { pan: -0.35 }), song.part('pad2', 'pad', { pan: 0 }), song.part('pad3', 'pad', { pan: 0.35 })],
    bass: song.part('bass', 'synthbass', { pan: 0 }),
    kick: song.part('kick', 'kick', { pan: 0 }),
    snare: song.part('snare', 'snare', { pan: 0 }),
    clap: song.part('clap', 'clap', { pan: 0.1 }),
    tom: song.part('tom', 'tom', { pan: -0.2 }),
    hat: song.part('hat', 'hat', { pan: 0.3 }),
    ohat: song.part('ohat', 'ohat', { pan: 0.3 }),
  };
  let voicing = null;
  const lowRoot = (ch) => { const m = midi('C2') + ch.bass % 12; return m > midi('G2') ? m - 12 : m; };
  const bassFig = (bar, ch, fig, vol = 1) => {
    const low = lowRoot(ch);
    const hits = [...fig].map((x, i) => [x, i]).filter(([x]) => x !== '.');
    hits.forEach(([x, i], k) => {
      const next = hits[k + 1]?.[1] ?? 16;
      const m = x === 'o' ? low + 12 : x === 'f' ? low + 7 : low;
      P.bass.note(bar, i, m, Math.max(1, next - i - 1), vol * (i % 4 === 0 ? 0.9 : i % 2 === 0 ? 0.74 : 0.6));
    });
  };

  // ── 1-8: the build ──
  DROP.forEach((sym, c) => {
    const ch = chord(sym), bar = 1 + c * 2;
    voicing = voiceLead(ch, voicing, { lo: 'G3', hi: 'E5', n: 3 });
    // the pads swell louder chord by chord
    voicing.forEach((m, v) => P.pad[v].note(bar, 0, m, 32, 0.4 + 0.07 * c));
    if (c >= 2) {
      // the arp and a held bass come in for the second half, getting louder
      P.arp.arp(bar, 0, ch, { rows: 32, rate: 1, shape: 'up', lo: 'A4', octaves: 2, vol: 0.32 + 0.1 * (c - 2) });
      P.bass.note(bar, 0, lowRoot(ch), 15, 0.6).note(bar + 1, 0, lowRoot(ch) + 12, 15, 0.65);
    }
  });
  // sixteenth hats from bar 7, rising
  for (let i = 0; i < 32; i++) P.hat.note(7 + (i >> 4), i & 15, HAT, 1, 0.3 + 0.4 * (i / 31) * HAT_ACCENT[i & 15]);
  // the snare roll: eighths in bar 7, sixteenths in bar 8 up to the last beat, louder all the way
  for (let i = 0; i < 16; i += 2) P.snare.note(7, i, SNARE, 1, 0.3 + 0.015 * i);
  for (let i = 0; i < 12; i++) P.snare.note(8, i, SNARE, 1, 0.5 + 0.035 * i);
  // toms climbing under the roll, then the last beat of bar 8 empty: the breath before the drop
  ['A2', 'C3', 'D3', 'F3', 'G3', 'A3'].forEach((n, k) => P.tom.note(8, k * 2, n, 1, 0.5 + 0.06 * k));
  P.hat.clear(8, 8);
  for (let i = 0; i < 12; i++) P.hat.note(8, i, HAT, 1, 0.55 + 0.02 * i);
  P.arp.rows.fill(null, P.arp.at(8, 12), P.arp.at(9, 0));

  // ── the drops and the breakdown ──
  const section = (bar0, kind) => {
    const chords = (kind === 'B' ? BREAK : DROP).map(chord);
    chords.forEach((ch, c) => {
      const bar = bar0 + c * 2;
      voicing = voiceLead(ch, voicing, { lo: 'G3', hi: 'E5', n: 3 });
      if (kind === 'B') {
        for (let b = 0; b < 2; b++) for (const [row, len, v] of [[0, 3, 0.8], [6, 2, 0.62], [12, 3, 0.7]]) {
          voicing.forEach((m, k) => P.pad[k].note(bar + b, row, m, len, v, { instrument: 'brass' }));
        }
      } else {
        for (let q = 0; q < 8; q++) voicing.forEach((m, v) => P.pad[v].note(bar + (q >> 2), (q & 3) * 4, m, 4, q % 4 ? 0.6 : 0.7, { instrument: 'pump' }));
      }
      const fig = kind === 'B' ? 'r.r.r.r.r.r.r.r.' : kind === 'D2' ? 'r.rrr.rrr.rrr.rr' : 'r.o.r.o.r.o.r.o.';
      bassFig(bar, ch, fig); bassFig(bar + 1, ch, c === 3 && kind !== 'B' ? 'r.r.r.r.r.r.o.f.' : fig);
      // the lead
      let text;
      if (kind === 'B') text = BREAK_LEAD[c];
      else if (kind === 'D1b' && c === 3) text = HOOK_LIFT;
      else if (kind === 'D2' && c === 0) text = HOOK_HIGH;
      else text = HOOK_A[c];
      P.lead.line(bar, text, 0.8);
      // the arp under the breakdown's second half, and quietly under the drops
      if (kind === 'B' ? c >= 2 : true) P.arp.arp(bar, 0, ch, { rows: 32, rate: 1, shape: kind === 'B' ? 'updown' : 'up', lo: 'A4', octaves: 2, vol: kind === 'B' ? 0.6 : 0.4 });
      // drums
      const kit = kind === 'B' ? HALF : FOUR;
      for (let b = 0; b < 2; b++) {
        const at = bar + b;
        P.kick.hits(at, kit.kick, KICK, { scale: 0.95 });
        P.snare.hits(at, kit.snare, SNARE, { scale: 0.9 });
        if (kind === 'D2') P.clap.hits(at, kit.snare, SNARE, { scale: 0.7 });
        P.hat.hits(at, kind === 'B' ? kit.hat : 'xxxxxxxxxxxxxxxx', HAT, { scale: 0.72, accent: HAT_ACCENT });
        if (kit.ohat) P.ohat.hits(at, kit.ohat, HAT, { scale: 0.5 });
        if (at % 8 === 0) {
          for (let i = 8; i < 16; i++) P.hat.rows[P.hat.at(at, i)] = null;
          [[8, 'G3'], [10, 'G3'], [12, 'D3'], [13, 'D3'], [14, 'A2'], [15, 'A2']].forEach(([row, n], k) => P.tom.note(at, row, n, 1, 0.62 + 0.04 * k));
        }
      }
    });
  };
  section(9, 'D1');
  section(17, 'D1b');
  section(25, 'B');
  section(33, 'D2');
  // the drop's downbeat lands with an open hat and a clap on top of the kick
  for (const bar of [9, 33]) { P.ohat.note(bar, 0, HAT, 1, 0.75); P.clap.note(bar, 0, SNARE, 1, 0.7); }

  P.echo.echoOf(P.lead, { rows: 3, vol: 0.42, wrap: false });
  P.echo.clear(25, 32);
  for (const [k, p] of Object.entries(P)) for (const part of Array.isArray(p) ? p : [p]) part.humanize(r, { vel: k === 'hat' ? 0.1 : 0.05 });
  return song.toSong('song_clone_wake', { instrumentId: INST_ID, category: 'ambient', priority: 5, loopStart: 8 * 16 });
}

export const songs = [compose('clone wake')];
for (const s of songs) s.channels.forEach((c, k) => c.forEach((st, i) => { if (st && i + (st.len || 1) > c.length) throw new Error(`${s.name} ch ${k}: ${st.note} at ${i} runs past the end`); }));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let stale = 0;
  for (const [rel, row] of [[`content/audio_instruments/${HOOK.id}.json`, HOOK], ...songs.map((s) => [`content/audio_songs/${s.id}.json`, s])]) {
    const p = path.join(ROOT, rel), want = canonicalJson(row);
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === want) continue;
    stale++;
    if (CHECK) console.error(`✗ ${rel} is behind scripts/content/build-clone-wake.mjs`);
    else { fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`); }
  }
  if (CHECK && stale) process.exit(1);
  const s = songs[0];
  console.log(`✓ ${s.name}: ${s.channels.length} channels, 40 bars at ${s.tempo} bpm (${(40 * 4 * 60 / s.tempo).toFixed(0)} s), loops from bar 9`);
}
