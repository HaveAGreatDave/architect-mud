// The seven background loops (neon_rain, data_heist, explore_loop, dead_zone, ghost_signal,
// upper_deck, pulse_reactor), composed on scripts/audio/compose-lib.mjs and written as tracker
// songs over one shared FM-forward palette.
//
//   node scripts/content/build-ambient-loops.mjs           write the instrument and song files
//   node scripts/content/build-ambient-loops.mjs --check   fail if the files are behind this script
//   node scripts/audio/song-lint.mjs --module scripts/content/build-ambient-loops.mjs
//   node scripts/audio/song-render.mjs neon_rain --wav neon_rain.wav
//
// They replace hand-typed loops of the same names and ids: two or three channels, one velocity a
// channel, every note a row long, the same bar over and over (song-lint flagged all seven). Each
// is now a 32-bar loop in the form A A' B A'' (docs/reference/game-music-craft.md#form):
//   A    the tune over pad, bass and a light kit
//   A'   the same tune with its echo (three rows behind, quieter, the other side), the arp in
//   B    new chords, a second tune for four bars and then the arp alone (call and response),
//        the drums change feel
//   A''  everything, the tune varied, a fill into the loop point
// Every song ends its loop on a chord that leans back into the first, swings a little, and
// humanises its velocities from a seed, so the files are the same every run.
//
// None of these is wired to a zone, a region or a broadcast today; they're the music player's
// and the dev panel's. Assigning one is a content decision (a region's `defaults.audio_theme_id`).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import { lint } from '../audio/song-lint.mjs';
import { Song, chord, scale, voiceLead, rng, motif, realise, vary, midi, stepBy, HAT_ACCENT } from '../audio/compose-lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

// ── the palette ─────────────────────────────────────────────────────────────
// FM where FM is the sound (the e-piano's 14:1 tine, the bell's 3.5:1, the bass's 2:1 growl), saws
// where warmth is. No modulator sits at ratio 1 or 0.5 on anything that holds
// (docs/systems-hockey-sound.md: a sideband lands on 0 Hz). Levels are set so a part at vol 0.8
// sits where docs/reference/game-music-craft.md#mix puts its role.
const env = (a, d, s, r, curve) => ({ a, d, s, r, ...(curve ? { curve } : {}) });
const lp = (freq, q = 0.7) => ({ type: 'lowpass', freq, q });
const hp = (freq, q = 0.7) => ({ type: 'highpass', freq, q });
const bp = (freq, q = 0.8) => ({ type: 'bandpass', freq, q });
const PALETTE = {
  epiano: { name: 'Loops: FM electric piano', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.2, adsr: env(0.002, 1.9, 0, 0.5, 'exp'), fm: { ratio: 14, index: 1.1, indexEnd: 0.04, time: 0.4, bright: 1.2 } },
    { waveform: 'sine', gain: 0.17, adsr: env(0.004, 2.4, 0.15, 0.6, 'exp'), fm: { ratio: 2, index: 0.35, indexEnd: 0.08, time: 0.6 } },
    { waveform: 'triangle', tune: 12, gain: 0.03, adsr: env(0.002, 0.5, 0, 0.3, 'exp') },
  ] },
  bell: { name: 'Loops: FM bell', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.17, adsr: env(0.001, 1.6, 0, 0.6, 'exp'), fm: { ratio: 3.5, index: 1.4, indexEnd: 0.1, time: 0.3, bright: 1 } },
    { waveform: 'sine', tune: 12, gain: 0.04, adsr: env(0.001, 0.5, 0, 0.3, 'exp') },
  ] },
  lead: { name: 'Loops: Glass lead', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -6, gain: 0.09, adsr: env(0.01, 0.25, 0.7, 0.18), filter: lp(1400, 1.2),
      mods: [{ id: 'bl', type: 'env', a: 0.01, d: 0.3, s: 0.3, r: 0.2, to: [{ param: 'filter.cutoff', amount: 2000 }] },
        { id: 'vb', type: 'lfo', wave: 'sine', rate: 5.2, fade: 0.45, to: [{ param: 'pitch', amount: 11 }] }] },
    { waveform: 'square', detune: 6, gain: 0.06, adsr: env(0.012, 0.25, 0.7, 0.18), filter: lp(1800, 0.8),
      mods: [{ id: 'vb', type: 'lfo', wave: 'sine', rate: 4.9, fade: 0.5, to: [{ param: 'pitch', amount: 9 }] }] },
    { waveform: 'sine', gain: 0.1, adsr: env(0.008, 0.3, 0.8, 0.18), fm: { ratio: 2, index: 0.6, indexEnd: 0.25, time: 0.2 } },
  ] },
  pluck: { name: 'Loops: Pluck', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', gain: 0.14, adsr: env(0.002, 0.22, 0, 0.12, 'exp'), filter: lp(700, 2),
      mods: [{ id: 'op', type: 'env', a: 0.001, d: 0.12, s: 0, r: 0.1, curve: 'exp', to: [{ param: 'filter.cutoff', amount: 3000 }] }] },
    { waveform: 'sine', tune: 12, gain: 0.05, adsr: env(0.001, 0.15, 0, 0.1, 'exp'), fm: { ratio: 3, index: 1.2, indexEnd: 0.1, time: 0.1 } },
  ] },
  pad: { name: 'Loops: Night pad', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -9, gain: 0.07, adsr: env(0.9, 0.5, 0.85, 1.4), filter: lp(1100, 0.8),
      mods: [{ id: 'sw', type: 'lfo', wave: 'triangle', rate: 0.13, to: [{ param: 'filter.cutoff', amount: 500 }] }],
      chorus: { rate: 0.4, depth: 0.35, delay: 0.018, mix: 0.45 } },
    { waveform: 'sawtooth', detune: 8, gain: 0.07, adsr: env(1.0, 0.5, 0.85, 1.4), filter: lp(950, 0.8) },
    { waveform: 'triangle', tune: -12, gain: 0.035, adsr: env(1.0, 0.5, 0.9, 1.4) },
  ] },
  fmbass: { name: 'Loops: FM bass', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.36, adsr: env(0.003, 0.35, 0.55, 0.1, 'exp'), filter: lp(1200, 0.7),
      fm: { ratio: 2, index: 1.8, indexEnd: 0.35, time: 0.18, bright: 1.4 }, sub: { level: 0.4, octave: 1, wave: 'sine' } },
    // the pick: a few milliseconds of bright saw so the note speaks on a small speaker
    { waveform: 'sawtooth', tune: 12, gain: 0.05, adsr: env(0.001, 0.03, 0, 0.02, 'exp'), filter: lp(2500, 0.8) },
  ] },
  kick: { name: 'Loops: Kick', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.62, adsr: env(0.001, 0.38, 0, 0.08, 'exp'),
      mods: [{ id: 'dr', type: 'env', a: 0.001, d: 0.06, s: 0, r: 0.05, curve: 'exp', to: [{ param: 'pitch', amount: 2400 }] }] },
    { waveform: 'noise', noiseMix: 1, gain: 0.06, adsr: env(0.0005, 0.012, 0, 0.01, 'exp'), filter: bp(1800, 0.8), noiseSeed: 5 },
  ] },
  snare: { name: 'Loops: Snare', waveform: 'triangle', layers: [
    { waveform: 'noise', noiseMix: 1, gain: 0.32, adsr: env(0.0008, 0.16, 0, 0.08, 'exp'), filter: bp(2600, 0.6), noiseSeed: 17 },
    { waveform: 'triangle', gain: 0.24, adsr: env(0.0008, 0.07, 0, 0.04, 'exp'),
      mods: [{ id: 'tk', type: 'env', a: 0.001, d: 0.03, s: 0, r: 0.03, to: [{ param: 'pitch', amount: 500 }] }] },
  ] },
  rim: { name: 'Loops: Rim', waveform: 'triangle', layers: [
    { waveform: 'triangle', gain: 0.16, adsr: env(0.0005, 0.03, 0, 0.02, 'exp'), fm: { ratio: 2.37, index: 2, indexEnd: 0.3, time: 0.02 } },
    { waveform: 'noise', noiseMix: 1, gain: 0.08, adsr: env(0.0005, 0.02, 0, 0.015, 'exp'), filter: bp(3200, 1.2), noiseSeed: 29 },
  ] },
  hat: { name: 'Loops: Hat', waveform: 'square', layers: [
    { waveform: 'noise', noiseMix: 1, gain: 0.13, adsr: env(0.0005, 0.035, 0, 0.02, 'exp'), filter: hp(7500, 0.7), noiseSeed: 41 },
    { waveform: 'square', gain: 0.03, adsr: env(0.0005, 0.03, 0, 0.02, 'exp'), filter: hp(6000, 0.7), fm: { ratio: 2.71, index: 3, indexEnd: 1.5, time: 0.03 } },
  ] },
  ohat: { name: 'Loops: Open hat', waveform: 'square', layers: [
    { waveform: 'noise', noiseMix: 1, gain: 0.1, adsr: env(0.0005, 0.25, 0, 0.1, 'exp'), filter: hp(7000, 0.6), noiseSeed: 43 },
    { waveform: 'square', gain: 0.025, adsr: env(0.0005, 0.2, 0, 0.08, 'exp'), filter: hp(6000, 0.7), fm: { ratio: 2.71, index: 3, indexEnd: 1.8, time: 0.2 } },
  ] },
};
// Trims, in dB, from measuring each instrument at 48 kHz against the kick and setting it where
// the craft doc's mix table puts its role (kick 0, bass -2, lead -4, snare -4, arp and pad -10,
// hats -12). Applied to every layer's gain, so the layers keep their balance.
const TRIM = { fmbass: -3.5, epiano: -3, snare: 6, rim: 8, hat: 8, ohat: 4, pluck: 3 };
const INST_ID = (k) => `aud_inst_loop_${k}`;
// Drums play at one pitch; this is it.
const DRUM_NOTE = { kick: 'C2', snare: 'D3', rim: 'E4', hat: 'C5', ohat: 'C5' };

// ── the kits and bass figures ───────────────────────────────────────────────
const KITS = {
  half:   { kick: 'X.......o.......', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.' },
  broken: { kick: 'X.....x...X..x..', snare: '....X.......X...', hat: 'xxxxxxxxxxxxxxxx' },
  four:   { kick: 'X...X...X...X...', snare: '....X.......X...', hat: 'x.xxx.xxx.xxx.xx', ohat: '..x...x...x...x.' },
  sparse: { kick: 'X.........x.....', hat: '....x.......x...' },
  light:  { kick: 'X.....x.........', rim: '....o.......x...', hat: 'x.x.x.x.x.x.x.x.' },
};
const FILL = '....X.......XoXX';
// root (r), octave (o), fifth (f), rest (.); the figure's notes are held to the next one
const BASS = {
  root:   'r.........o...f.',
  pulse8: 'r.r.o.r.r.r.o.r.',
  off16:  '..r...r...r...r.',
  drone:  'r...............',
  walk:   'r.....f...o...f.',
};

// ── the songs ───────────────────────────────────────────────────────────────
// A section's chords are one per two bars (four to a section); B is the contrasting section.
const SPECS = [
  { id: 'song_neon_rain', name: 'neon_rain', category: 'ambient', priority: 4, tempo: 80, swing: 0.54, seed: 'neon rain',
    key: 'D', mode: 'phrygian', A: ['Dm', 'Eb', 'Dm', 'C'], B: ['Bbmaj7', 'C', 'Gm7', 'A7'],
    lead: 'epiano', arp: 'bell', anchor: 'A4', range: ['D4', 'F5'], density: 0.9,
    kit: { A: 'half', B: 'sparse' }, bass: { A: 'root', B: 'drone' } },
  { id: 'song_data_heist', name: 'data_heist', category: 'cyberpunk', priority: 5, tempo: 96, swing: 0.56, seed: 'data heist',
    key: 'C#', mode: 'harmonicMinor', A: ['C#m', 'A', 'F#m', 'G#7'], B: ['Amaj7', 'B', 'C#m', 'G#7'],
    lead: 'lead', arp: 'pluck', anchor: 'G#4', range: ['C#4', 'F#5'], density: 1.4, arpRate: 1,
    kit: { A: 'broken', B: 'half' }, bass: { A: 'pulse8', B: 'root' } },
  { id: 'song_explore_loop', name: 'explore_loop', category: 'ambient', priority: 4, tempo: 96, swing: 0.55, seed: 'explore',
    key: 'A', mode: 'dorian', A: ['Am7', 'D', 'Am7', 'G'], B: ['Fmaj7', 'G', 'Em7', 'E7'],
    lead: 'bell', arp: 'epiano', anchor: 'E5', range: ['A4', 'A5'], density: 1,
    kit: { A: 'light', B: 'sparse' }, bass: { A: 'walk', B: 'root' } },
  { id: 'song_dead_zone', name: 'dead_zone', category: 'ambient', priority: 3, tempo: 80, swing: 0.5, seed: 'dead zone',
    key: 'E', mode: 'phrygian', A: ['Em', 'F', 'Em', 'Dm'], B: ['Cmaj7', 'F', 'G', 'F'],
    lead: 'bell', arp: 'epiano', anchor: 'B4', range: ['E4', 'G5'], density: 0.5, arpRate: 4,
    kit: { A: 'sparse', B: 'sparse' }, bass: { A: 'drone', B: 'drone' } },
  { id: 'song_ghost_signal', name: 'ghost_signal', category: 'ambient', priority: 3, tempo: 80, swing: 0.53, seed: 'ghost signal',
    key: 'C', mode: 'minor', A: ['Cm', 'Ab', 'Eb', 'Bb'], B: ['Fm', 'Ab', 'G7', 'G7'],
    lead: 'epiano', arp: 'bell', anchor: 'G4', range: ['C4', 'Eb5'], density: 0.7, arpRate: 4,
    kit: { A: 'sparse', B: 'half' }, bass: { A: 'drone', B: 'root' } },
  { id: 'song_upper_deck', name: 'upper_deck', category: 'ambient', priority: 4, tempo: 100, swing: 0.55, seed: 'upper deck',
    key: 'C', mode: 'lydian', A: ['Cmaj7', 'D/C', 'Em7', 'Am7'], B: ['Fmaj7', 'G', 'Am7', 'G/B'],
    lead: 'lead', arp: 'pluck', anchor: 'E5', range: ['G4', 'G5'], density: 1.2,
    kit: { A: 'light', B: 'half' }, bass: { A: 'walk', B: 'pulse8' } },
  { id: 'aud_497cdcea-97e4-4e1a-99da-24e01577a849', name: 'pulse_reactor', category: 'cyberpunk', priority: 5, tempo: 132, swing: 0.52, seed: 'pulse reactor',
    key: 'A', mode: 'minor', A: ['Am', 'F', 'C', 'G'], B: ['Dm', 'F', 'E7', 'E7'],
    lead: 'lead', arp: 'pluck', anchor: 'E5', range: ['A4', 'A5'], density: 1.6, arpRate: 1,
    kit: { A: 'four', B: 'broken' }, bass: { A: 'off16', B: 'pulse8' } },
];

const BARS = 32;
// [first bar, section, chords] for the four sections
const FORM = [[1, 'A'], [9, "A'"], [17, 'B'], [25, "A''"]];

function compose(spec) {
  const r = rng(spec.seed);
  const sc = scale(spec.key, spec.mode);
  // spell in flats when the scale has E♭ or B♭ and no F♯
  const flats = (sc.pcs.has(3) || sc.pcs.has(10)) && !sc.pcs.has(6);
  const song = new Song({ name: spec.name, tempo: spec.tempo, bars: BARS, swing: spec.swing, key: { flats } });
  const P = {
    lead: song.part('lead', spec.lead, { pan: 0.05 }),
    echo: song.part('echo', spec.lead, { pan: 0.4 }),
    arp: song.part('arp', spec.arp, { pan: -0.35 }),
    pad: [song.part('pad1', 'pad', { pan: -0.3 }), song.part('pad2', 'pad', { pan: 0 }), song.part('pad3', 'pad', { pan: 0.3 })],
    bass: song.part('bass', 'fmbass', { pan: 0 }),
    kick: song.part('kick', 'kick', { pan: 0 }),
    snare: song.part('snare', 'snare', { pan: 0.05 }),
    rim: song.part('rim', 'rim', { pan: -0.15 }),
    hat: song.part('hat', 'hat', { pan: 0.3 }),
    ohat: song.part('ohat', 'ohat', { pan: 0.3 }),
  };
  const chordsOf = (sec) => (sec === 'B' ? spec.B : spec.A).map(chord);

  // the two tunes: M for the A sections, N for B. Two-bar motifs, one per chord.
  const M = motif(r, { rows: 32, density: spec.density, leapChance: 0.15 });
  const N = motif(r, { rows: 32, density: Math.max(0.5, spec.density * 0.7), leapChance: 0.1 });
  const phrase = (mo, sec) => [mo, vary(mo, r, 'answer'), vary(mo, r, sec === "A''" ? 'invert' : 'shift'), vary(mo, r, 'answer')];

  let voicing = null;
  for (const [bar0, sec] of FORM) {
    let anchor = midi(spec.anchor);
    const chords = chordsOf(sec);
    const kitName = sec === 'B' ? spec.kit.B : spec.kit.A;
    const kit = KITS[kitName];
    const tune = phrase(sec === 'B' ? N : M, sec);
    for (let c = 0; c < 4; c++) {
      const ch = chords[c], bar = bar0 + c * 2;
      // pad: voice-led triad held two bars (a fresh attack on the second bar of B for movement)
      voicing = voiceLead(ch, voicing, { lo: 'G3', hi: 'E5', n: 3 });
      voicing.forEach((m, v) => P.pad[v].note(bar, 0, m, sec === 'B' ? 16 : 32, sec === 'A' ? 0.55 : 0.68));
      if (sec === 'B') voicing.forEach((m, v) => P.pad[v].note(bar + 1, 0, m, 16, 0.5));
      // bass: the figure under the chord's bass note, both bars
      const root = midi(`C2`) + ((ch.bass - 0 + 12) % 12);
      const low = root > midi('G2') ? root - 12 : root;
      for (let b = 0; b < 2; b++) {
        const fig = BASS[sec === 'B' ? spec.bass.B : spec.bass.A];
        const hits = [...fig].map((x, i) => [x, i]).filter(([x]) => x !== '.');
        hits.forEach(([x, i], k) => {
          const next = hits[k + 1]?.[1] ?? 16;
          const m = x === 'o' ? low + 12 : x === 'f' ? low + 7 : low;
          const accent = i % 4 === 0 ? 0.85 : 0.65;
          P.bass.note(bar + b, i, m, Math.max(1, next - i - (fig === BASS.pulse8 || fig === BASS.off16 ? 1 : 0)), accent);
        });
      }
      // the tune
      const play = sec !== 'B' || c < 2;          // B: two chords of tune, then the arp answers
      if (play) {
        // each two bars start where the last ended (a sequence, not a jump back to the anchor),
        // drawn back toward the anchor when they've wandered more than a fourth from it
        const notes = realise(tune[c], sc, ch, anchor, { lo: spec.range[0], hi: spec.range[1] });
        const end = notes[notes.length - 1].m, home = midi(spec.anchor);
        anchor = Math.abs(end - home) > 5 ? stepBy(end, end > home ? -2 : 2, sc) : end;
        notes.forEach((n, k) => {
          const strong = n.row % 8 === 0;
          const len = Math.max(1, Math.min(n.len - (n.len > 2 ? 1 : 0), 32 - n.row));
          // the last note of each phrase rings
          const last = k === notes.length - 1 && c % 2 === 1;
          P.lead.note(bar + Math.floor(n.row / 16), n.row % 16, n.m, last ? Math.max(len, 32 - n.row) : len, strong ? 0.8 : 0.66);
        });
      }
      // the arp: A' and A'' throughout, B's answer bars
      const arpOn = sec === "A'" || sec === "A''" || (sec === 'B' && c >= 2);
      if (arpOn) {
        const rate = spec.arpRate || 2;
        P.arp.arp(bar, 0, ch, { rows: 32, rate, shape: sec === 'B' ? 'updown' : 'up', lo: 'A4', octaves: rate === 1 ? 1 : 2, vol: sec === 'B' ? 0.6 : 0.48, gate: rate > 2 ? 1 : 0.9 });
      }
      // drums
      for (let b = 0; b < 2; b++) {
        const at = bar + b, lastBar = at === BARS || at === 24;
        if (kit.kick) P.kick.hits(at, kit.kick, DRUM_NOTE.kick, { scale: 0.95 });
        if (kit.snare && sec !== 'A') P.snare.hits(at, lastBar ? FILL : kit.snare, DRUM_NOTE.snare, { scale: 0.85 });
        if (kit.snare && sec === 'A') P.rim.hits(at, kit.snare.replace(/X/g, 'x'), DRUM_NOTE.rim, { scale: 0.8 });
        if (kit.rim) P.rim.hits(at, kit.rim, DRUM_NOTE.rim, { scale: 0.85 });
        if (kit.hat) P.hat.hits(at, kit.hat, DRUM_NOTE.hat, { scale: sec === 'A' ? 0.6 : 0.75, accent: HAT_ACCENT });
        if (kit.ohat && sec !== 'A') P.ohat.hits(at, kit.ohat, DRUM_NOTE.ohat, { scale: 0.5 });
      }
    }
  }
  // the echo: the tune three rows later, quieter, in A' and A'' only
  P.echo.echoOf(P.lead, { rows: 3, vol: 0.42, wrap: false });
  P.echo.clear(1, 8).clear(17, 24);
  // hands: velocities move by a little, the hats and the arp drift late by a hair
  for (const [k, p] of Object.entries(P)) {
    for (const part of Array.isArray(p) ? p : [p]) part.humanize(r, { vel: k === 'hat' ? 0.12 : 0.07, late: k === 'hat' || k === 'arp' ? 0.06 : 0 });
  }
  return song.toSong(spec.id, { instrumentId: INST_ID, category: spec.category, priority: spec.priority });
}

// Every layer names its waveform (the Rack writes one onto any that don't).
export const instruments = Object.entries(PALETTE).map(([key, def]) => ({
  id: INST_ID(key), name: def.name, category: 'loops', waveform: def.waveform, enabled: 1, sample_id: null,
  config: { layers: def.layers.map((l) => ({ waveform: def.waveform, ...l, gain: +(l.gain * Math.pow(10, (TRIM[key] || 0) / 20)).toFixed(4) })) },
}));
// Takes. Each song is composed TAKES times from seeds derived from its own, and the take the
// critic (scripts/audio/song-lint.mjs) marks best is kept: a lead near 65% steps (Huron's
// corpora run 60-75%), few leaps left hanging, the notes in the key, no warnings. The choice is
// a pure function of the specs, so the files are the same every run.
const TAKES = 12;
function grade(song) {
  const r = lint(song, Object.fromEntries(instruments.map((i) => [i.id, i])));
  const steps = r.lead?.steps ?? 0;
  const warns = r.findings.filter((f) => f.level === 'warn').length;
  const leaps = +(r.findings.find((f) => /big leaps/.test(f.msg))?.msg.match(/(\d+) big/)?.[1] ?? 0);
  return Math.abs(steps - 0.65) * 4 + leaps * 0.15 + warns * 2 + (1 - r.scaleFit) * 3;
}
export const songs = SPECS.map((spec) => {
  let best = null;
  for (let t = 0; t < TAKES; t++) {
    const song = compose({ ...spec, seed: `${spec.seed} #${t}` });
    const g = grade(song);
    if (!best || g < best.g) best = { song, g, t };
  }
  return best.song;
});
for (const s of songs) {
  s.channels.forEach((c, k) => c.forEach((st, i) => { if (st && i + (st.len || 1) > c.length) throw new Error(`${s.name} ch ${k}: ${st.note} at ${i} runs past the end`); }));
  for (const id of s.instrument_ids) if (!instruments.some((r) => r.id === id)) throw new Error(`${s.name}: no instrument ${id}`);
}

// ── write ───────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = [
    ...instruments.map((r) => [`content/audio_instruments/${r.id}.json`, r]),
    ...songs.map((s) => [`content/audio_songs/${s.id}.json`, s]),
  ];
  let stale = 0;
  for (const [rel, row] of files) {
    const p = path.join(ROOT, rel);
    const want = canonicalJson(row);
    const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (have === want) continue;
    stale++;
    if (CHECK) console.error(`✗ ${rel} is behind scripts/content/build-ambient-loops.mjs`);
    else { fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`); }
  }
  if (CHECK && stale) process.exit(1);
  for (const s of songs) {
    const notes = s.channels.reduce((n, c) => n + c.filter(Boolean).length, 0);
    console.log(`${CHECK ? '✓ up to date' : '✓ built'}: ${s.name}, ${s.channels.length} channels, ${notes} notes, ${BARS} bars at ${s.tempo} bpm (${(BARS * 16 * 60 / s.tempo / 4).toFixed(0)} s), swing ${s.swing ?? 0.5}`);
  }
}
