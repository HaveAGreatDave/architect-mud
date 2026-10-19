// The KSAB-7 Sports theme for Deadball: written here as a score, compiled to a tracker song.
//
//   node scripts/content/build-ksab-theme.mjs           write the instrument and song files
//   node scripts/content/build-ksab-theme.mjs --check   fail if the files are behind this script
//
// The song plays under Deadball's title card, once (`@theme` in data/scripts/baseball.bsm), and
// the card holds for it. scripts/audio/song-render.mjs renders it to a WAV to listen to.
//
// THE TUNE. The park's organist knows one song, in D minor and about drowning
// (client/shared/deadball-sfx.js, DIRGE): A D F E D C A, B♭ A G A D. The network took it.
// Bar 1 is the organ alone, the first three notes in D major, and the orchestra comes in
// under the third. From there the theme is the same song, note for note:
//
//   A A D F♯ E | D C♯ A | B♭ A G A | D
//
// Its first bar is a fanfare already (5, 1, 3: a bugle call). Its third bar keeps the
// dirge's B♭, which is what makes it a network theme rather than a hymn: over B♭ and C it
// becomes ♭VI, ♭VII, I, the cadence every big sports open ends on. The second bar is a 4-3
// suspension over A.
//
// THE FORM (132 bpm, 19 bars, about 34 seconds):
//   1      the organ, alone; strings, timpani and a cymbal swell rise under its last note
//   2      the hit, and the brass call (A A A D)
//   3-6    the theme in the horns, over a 3-3-2 ostinato in the low strings
//   7-10   the theme an octave up in the trumpets, the horns against it, the drums in
//   11-12  the lift: the call in canon (trombones, then horns a fifth up a beat later), then
//          C and D hammered in 3-3-2, ♭VI and ♭VII of the key a tone up
//   13-16  the theme in E, everything, the glockenspiel on top
//   17-18  the kicks, a trumpet run to the top, the last chord and the button
//   19     silence, for the tails
//
// THE ORCHESTRA is ten instruments in the layer schema (docs/amp-format.md), each a few
// layers played at the note's pitch: brass is sawtooth whose lowpass opens on the attack
// and settles, scooped up into the note, with a vibrato that arrives late; strings are
// detuned saws; the percussion is noise and tuned sine. Long notes use a step's `len`.
// Only what sustains gets an echo: a delay line per sixteenth would be hundreds a minute.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

export const SONG_NAME = 'ksab7_deadball_theme';
const SONG_ID = `aud_song_${SONG_NAME}`;
const TEMPO = 132;
const ROW = 16;                 // rows a bar: a row is a 16th
const BARS = 19;
const ROWS = BARS * ROW;
// The song's level, under every step's vol: orchestral hits stack at the downbeats, and this
// keeps the busiest ones to about 3 dB over full scale, which the master limiter holds.
const MASTER = 0.85;

// ── pitch ───────────────────────────────────────────────────────────────────
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const midi = (n) => { const m = /^([A-G][#b]?)(-?\d)$/.exec(n); if (!m || PC[m[1]] == null) throw new Error(`bad note ${n}`); return (+m[2] + 1) * 12 + PC[m[1]]; };
const nameOf = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
// the lowest note at or above `floor` whose pitch class is `pc`
const above = (pc, floor) => floor + ((PC[pc] - (floor % 12)) + 12) % 12;

// ── the orchestra ───────────────────────────────────────────────────────────
const env = (a, d, s, r, curve) => ({ a, d, s, r, ...(curve ? { curve } : {}) });
const lp = (freq, q = 0.8) => ({ type: 'lowpass', freq, q });
const bp = (freq, q = 0.8) => ({ type: 'bandpass', freq, q });
const hp = (freq, q = 0.7) => ({ type: 'highpass', freq, q });
// the brass bloom: the cutoff opens on the attack and settles back as the note holds
const bloom = (id, cents, a, d, s) => ({ id, type: 'env', a, d, s, r: 0.2, to: [{ param: 'filter.cutoff', amount: cents }] });
// a lip scoop up into the note, and a struck pitch falling to rest
const bend = (id, cents, d) => ({ id, type: 'env', a: 0.001, d, s: 0, r: 0.05, to: [{ param: 'pitch', amount: cents }] });
// vibrato that arrives once the note has settled
const vib = (id, rate, cents, fade) => ({ id, type: 'lfo', wave: 'sine', rate, fade, to: [{ param: 'pitch', amount: cents }] });

const INSTRUMENTS = {
  trumpet: { name: 'Orchestra: Trumpets', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -5, gain: 0.17, adsr: env(0.025, 0.18, 0.82, 0.16), filter: lp(1500, 1.0),
      mods: [bloom('bl', 2200, 0.03, 0.22, 0.6), bend('sc', -35, 0.06), vib('vb', 5.3, 10, 0.45)],
      echo: { mix: 0.12, delay: 0.13, feedback: 0.3 } },
    { waveform: 'sawtooth', detune: 6, gain: 0.13, adsr: env(0.03, 0.2, 0.8, 0.17), filter: lp(1800, 0.8),
      mods: [bloom('bl', 1900, 0.035, 0.25, 0.55), vib('vb', 5.0, 9, 0.5)] },
    // the bell's edge: the band brass is loudest in, strongest on the attack
    { waveform: 'sawtooth', detune: 2, gain: 0.3, adsr: env(0.03, 0.3, 0.55, 0.16), filter: bp(1900, 1.1) },
  ] },
  horn: { name: 'Orchestra: Horns', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -4, gain: 0.19, adsr: env(0.06, 0.25, 0.85, 0.25), filter: lp(950, 0.8),
      mods: [bloom('bl', 1800, 0.07, 0.3, 0.5), bend('sc', -20, 0.08), vib('vb', 4.8, 7, 0.6)],
      echo: { mix: 0.18, delay: 0.15, feedback: 0.35 } },
    { waveform: 'triangle', detune: 5, gain: 0.11, adsr: env(0.07, 0.25, 0.85, 0.25), filter: lp(1500, 0.7) },
    { waveform: 'sawtooth', detune: -2, gain: 0.2, adsr: env(0.06, 0.35, 0.5, 0.25), filter: bp(1150, 1.0) },
  ] },
  trombone: { name: 'Orchestra: Trombones', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -4, gain: 0.16, adsr: env(0.035, 0.2, 0.85, 0.18), filter: lp(800, 1.1),
      mods: [bloom('bl', 2100, 0.04, 0.25, 0.5)], echo: { mix: 0.12, delay: 0.11, feedback: 0.3 } },
    { waveform: 'sawtooth', detune: 5, gain: 0.13, adsr: env(0.04, 0.22, 0.85, 0.18), filter: lp(800, 0.8),
      mods: [bloom('bl', 1800, 0.045, 0.28, 0.45)] },
    { waveform: 'sawtooth', gain: 0.2, adsr: env(0.04, 0.3, 0.5, 0.18), filter: bp(1100, 1.1) },
  ] },
  tuba: { name: 'Orchestra: Tuba', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', gain: 0.17, adsr: env(0.03, 0.2, 0.8, 0.16), filter: lp(260, 0.9),
      mods: [bloom('bl', 1700, 0.035, 0.22, 0.45)] },
    { waveform: 'triangle', gain: 0.1, adsr: env(0.03, 0.2, 0.85, 0.16), filter: lp(400, 0.7) },
  ] },
  strings: { name: 'Orchestra: Violins, spiccato', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -8, gain: 0.24, noiseMix: 0.04, adsr: env(0.006, 0.09, 0.35, 0.08), filter: lp(4500, 0.7) },
    { waveform: 'sawtooth', detune: 9, gain: 0.24, adsr: env(0.008, 0.09, 0.35, 0.08), filter: lp(4000, 0.7) },
  ] },
  cellos: { name: 'Orchestra: Cellos and basses', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -7, gain: 0.14, noiseMix: 0.03, adsr: env(0.008, 0.11, 0.4, 0.1), filter: lp(1800, 0.8) },
    { waveform: 'sawtooth', detune: 7, gain: 0.12, adsr: env(0.01, 0.11, 0.4, 0.1), filter: lp(1500, 0.8) },
    { waveform: 'triangle', tune: -12, gain: 0.045, adsr: env(0.01, 0.12, 0.45, 0.1), filter: lp(300, 0.7) },
  ] },
  pad: { name: 'Orchestra: Strings, sustained', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -9, gain: 0.12, adsr: env(0.18, 0.3, 0.9, 0.45), filter: lp(3500, 0.6),
      mods: [vib('vb', 5.6, 11, 0.5)], echo: { mix: 0.22, delay: 0.17, feedback: 0.42 } },
    { waveform: 'sawtooth', detune: 9, gain: 0.12, adsr: env(0.2, 0.3, 0.9, 0.45), filter: lp(3200, 0.6),
      mods: [vib('vb', 5.1, 10, 0.55)] },
  ] },
  timpani: { name: 'Orchestra: Timpani', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.28, adsr: env(0.002, 1.6, 0, 0.5, 'exp'), filter: lp(900, 0.7),
      fm: { ratio: 2.44, index: 0.9, indexEnd: 0.05, time: 0.25 }, mods: [bend('st', 45, 0.12)],
      echo: { mix: 0.2, delay: 0.19, feedback: 0.4 } },
    { noiseMix: 1, gain: 0.13, adsr: env(0.001, 0.25, 0, 0.2, 'exp'), filter: bp(320, 0.9), noiseSeed: 11 },
    { noiseMix: 1, gain: 0.05, adsr: env(0.0005, 0.02, 0, 0.02, 'exp'), filter: bp(2200, 0.7), noiseSeed: 23 },
  ] },
  snare: { name: 'Orchestra: Snare drum', waveform: 'triangle', layers: [
    { noiseMix: 1, gain: 0.68, adsr: env(0.0008, 0.17, 0, 0.08, 'exp'), filter: bp(3800, 0.6), noiseSeed: 31,
      echo: { mix: 0.12, delay: 0.12, feedback: 0.28 } },
    { waveform: 'triangle', gain: 0.5, adsr: env(0.0008, 0.06, 0, 0.04, 'exp'), mods: [bend('tk', 300, 0.03)] },
    { noiseMix: 1, gain: 0.3, adsr: env(0.0005, 0.09, 0, 0.05, 'exp'), filter: hp(6000, 0.7), noiseSeed: 47 },
  ] },
  bassdrum: { name: 'Orchestra: Bass drum', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.3, adsr: env(0.002, 1.2, 0, 0.3, 'exp'), mods: [bend('bt', 900, 0.07)] },
    { noiseMix: 1, gain: 0.13, adsr: env(0.001, 0.35, 0, 0.2, 'exp'), filter: lp(180, 0.8), noiseSeed: 59 },
    { noiseMix: 1, gain: 0.03, adsr: env(0.0005, 0.015, 0, 0.02, 'exp'), filter: bp(1200, 0.7), noiseSeed: 61 },
  ] },
  crash: { name: 'Orchestra: Crash cymbal', waveform: 'square', layers: [
    { noiseMix: 1, gain: 0.3, adsr: env(0.001, 2.6, 0, 1.2, 'exp'), filter: hp(3500, 0.5), width: 0.9, noiseSeed: 71 },
    { waveform: 'square', gain: 0.06, adsr: env(0.001, 2.0, 0, 1.0, 'exp'), filter: hp(2500, 0.6),
      fm: { ratio: 2.37, index: 3.5, indexEnd: 1.2, time: 1.5 } },
    { noiseMix: 1, gain: 0.14, adsr: env(0.001, 1.2, 0, 0.6, 'exp'), filter: bp(7000, 0.8), width: 0.7, noiseSeed: 83 },
  ] },
  swell: { name: 'Orchestra: Suspended cymbal roll', waveform: 'square', layers: [
    { noiseMix: 1, gain: 0.22, adsr: env(1.3, 0.05, 1, 0.35), filter: hp(2800, 0.5), width: 0.9, noiseSeed: 97,
      mods: [{ id: 'op', type: 'env', a: 1.3, d: 0.05, s: 1, r: 0.3, to: [{ param: 'filter.cutoff', amount: 1200 }] }] },
    { noiseMix: 1, gain: 0.08, adsr: env(1.3, 0.05, 1, 0.35), filter: bp(9000, 1), width: 0.8, noiseSeed: 101 },
  ] },
  glock: { name: 'Orchestra: Glockenspiel', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.2, adsr: env(0.001, 1.4, 0, 0.5, 'exp'), fm: { ratio: 3.5, index: 1.4, indexEnd: 0.1, time: 0.25 },
      echo: { mix: 0.25, delay: 0.21, feedback: 0.38 } },
    { waveform: 'sine', tune: 17.57, gain: 0.05, adsr: env(0.001, 0.4, 0, 0.2, 'exp') },
  ] },
  // The park's own organ, tired and in a hall: the stops of deadball-sfx.js's organ, a
  // Leslie's tremolo and a key click.
  organ: { name: 'Ballpark organ', waveform: 'triangle', layers: [
    { waveform: 'triangle', detune: -4, gain: 0.32, adsr: env(0.008, 0.05, 1, 0.08), tremolo: { rate: 6.4, depth: 0.12 },
      echo: { mix: 0.3, delay: 0.23, feedback: 0.45 } },
    { waveform: 'sine', tune: 12, detune: -4, gain: 0.145, adsr: env(0.008, 0.05, 1, 0.08), tremolo: { rate: 6.4, depth: 0.12 } },
    { waveform: 'sine', tune: 19, detune: -4, gain: 0.065, adsr: env(0.008, 0.05, 1, 0.08) },
    { noiseMix: 1, gain: 0.08, adsr: env(0.001, 0.004, 0, 0.003), filter: bp(2400, 0.8), noiseSeed: 107 },
  ] },
};
const INST_ID = (key) => `aud_inst_orch_${key}`;

// ── the score ───────────────────────────────────────────────────────────────
// A part is one channel: one note at a time. `line(bar, text)` reads tokens from a bar:
//   NOTE:LEN[@VOL]   a note `len` rows long (B4:3, F#5:8@0.9)
//   r:LEN            a rest
//   -:LEN            the note before held LEN rows more (across a bar line)
//   |                a bar line, which has to fall on one
class Part {
  constructor(key, inst, pan) { this.key = key; this.inst = inst; this.pan = pan; this.rows = new Array(ROWS).fill(null); }
  note(bar, row, note, len = 1, vol = 0.8) {
    const i = (bar - 1) * ROW + row;
    if (i < 0 || i >= ROWS) throw new Error(`${this.key}: bar ${bar} row ${row} is outside the song`);
    if (this.rows[i]) throw new Error(`${this.key}: bar ${bar} row ${row} already has ${this.rows[i].note}`);
    const n = typeof note === 'number' ? nameOf(note) : note;
    midi(n);
    this.rows[i] = { note: n, instrument: INST_ID(this.inst), vol: +(vol * MASTER).toFixed(3), ...(len > 1 ? { len } : {}) };
    this.last = this.rows[i];
    return this;
  }
  line(bar, text, vol = 0.8) {
    let at = 0;
    for (const tok of text.trim().split(/\s+/)) {
      if (tok === '|') { if (at % ROW) throw new Error(`${this.key}: bar line at row ${at} in "${text}"`); continue; }
      const m = /^([A-G][#b]?-?\d|r|-):(\d+)(?:@([\d.]+))?$/.exec(tok);
      if (!m) throw new Error(`${this.key}: bad token ${tok}`);
      const len = +m[2];
      if (m[1] === '-') { if (!this.last) throw new Error(`${this.key}: tie with nothing to hold`); this.last.len = (this.last.len || 1) + len; }
      else if (m[1] !== 'r') this.note(bar + Math.floor(at / ROW), at % ROW, m[1], len, m[3] != null ? +m[3] : vol);
      at += len;
    }
    return this;
  }
  // a drum pattern for one bar: X loud, x normal, o soft, . nothing
  hits(bar, pattern, note, scale = 1) {
    const V = { X: 0.9, x: 0.6, o: 0.32 };
    [...pattern.replace(/\s/g, '')].forEach((c, row) => { if (V[c]) this.note(bar, row, note, 1, V[c] * scale); });
    return this;
  }
  // a roll: every row from..to on one note, the level going from v0 to v1
  roll(bar, from, to, note, v0, v1) {
    for (let r = from; r <= to; r++) this.note(bar + Math.floor(r / ROW), r % ROW, note, 1, v0 + (v1 - v0) * (to === from ? 1 : (r - from) / (to - from)));
    return this;
  }
}

// Orchestral seating, from the stalls: violins left, cellos and basses right, horns
// left of centre, trumpets and trombones right of it.
const P = {
  tpt1: new Part('tpt1', 'trumpet', 0.12), tpt2: new Part('tpt2', 'trumpet', 0.22),
  hrn1: new Part('hrn1', 'horn', -0.28), hrn2: new Part('hrn2', 'horn', -0.36),
  tbn1: new Part('tbn1', 'trombone', 0.3), tbn2: new Part('tbn2', 'trombone', 0.38), tuba: new Part('tuba', 'tuba', 0.42),
  vln: new Part('vln', 'strings', -0.45), vla: new Part('vla', 'pad', -0.15), vc: new Part('vc', 'cellos', 0.35),
  timp: new Part('timp', 'timpani', -0.1), snare: new Part('snare', 'snare', 0.05), bd: new Part('bd', 'bassdrum', -0.05),
  cym: new Part('cym', 'crash', 0), keys: new Part('keys', 'glock', -0.3), hi: new Part('hi', 'pad', -0.05),
};

// The harmony, a chord a half bar.
const CH = {
  D: ['D', 'F#', 'A'], A: ['A', 'C#', 'E'], Asus: ['A', 'D', 'E'], Bb: ['Bb', 'D', 'F'], C: ['C', 'E', 'G'],
  G: ['G', 'B', 'D'], E: ['E', 'G#', 'B'], B: ['B', 'D#', 'F#'], Bsus: ['B', 'E', 'F#'],
};
const HARMONY = {
  2: ['D', 'D'], 3: ['D', 'D'], 4: ['Asus', 'A'], 5: ['Bb', 'C'], 6: ['D', 'D'],
  7: ['D', 'D'], 8: ['Asus', 'A'], 9: ['Bb', 'C'], 10: ['D', 'D'], 11: ['G', 'G'], 12: ['C', 'D'],
  13: ['E', 'E'], 14: ['Bsus', 'B'], 15: ['C', 'D'], 16: ['E', 'E'], 17: ['E', 'E'],
};

// The low strings' engine: the root an octave apart in 3-3-2, low on the accents.
function cellos(bar, level) {
  HARMONY[bar].forEach((ch, half) => {
    const lo = above(CH[ch][0], 36), hi = lo + 12;
    [lo, hi, hi, lo, hi, hi, lo, hi].forEach((m, i) => P.vc.note(bar, half * 8 + i, m, 1, level * (i % 3 === 0 ? 1 : 0.62)));
  });
}
// The violins: the chord's three notes up from G4, cycled in sixteenths, so the cell of
// three runs across the bar's groups of four and its low note lands 3-3-2.
function violins(bar, level, floor = 67) {
  HARMONY[bar].forEach((ch, half) => {
    const cell = CH[ch].map((pc) => above(pc, floor)).sort((a, b) => a - b);
    for (let i = 0; i < 8; i++) P.vln.note(bar, half * 8 + i, cell[i % 3], 1, level * (i % 3 === 0 ? 1 : 0.7));
  });
}
// The sustained strings hold each chord's third, moving to the nearest one.
let padAt = midi('F#4');
function pad(bar, level) {
  HARMONY[bar].forEach((ch, half) => {
    const pc = CH[ch][1];
    const cands = [above(pc, padAt - 6), above(pc, padAt - 6) + 12].filter((m) => m >= 57 && m <= 79);
    padAt = cands.sort((a, b) => Math.abs(a - padAt) - Math.abs(b - padAt))[0];
    P.vla.note(bar, half * 8, padAt, 8, level);
  });
}
// The low brass and the timpani's 3-3-2 under a bar: dotted quarter, dotted quarter, quarter.
function kick332(part, bar, notes, level, lens = [5, 5, 4]) {
  [0, 6, 12].forEach((row, i) => part.note(bar, row, notes[i], lens[i], level * [1, 0.82, 0.9][i]));
}

// Bar 1: the organ alone. The orchestra rises under its third note.
P.keys.line(1, 'A3:4@0.7 D4:4@0.72 F#4:8@0.8');
P.keys.rows.slice(0, 16).forEach((s) => { if (s) s.instrument = INST_ID('organ'); });
P.vc.roll(1, 8, 15, 'D2', 0.18, 0.5);
P.timp.roll(1, 8, 15, 'A2', 0.2, 0.75);
P.cym.note(1, 4, 'C5', 12, 0.9);
P.cym.last.instrument = INST_ID('swell');

// Bar 2: the hit, then the call.
P.tpt1.line(2, 'D5:3@1 r:1 A4:1@0.85 A4:1@0.8 A4:2@0.9 D5:8@1');
P.tpt2.line(2, 'A4:3@0.95 r:1 F#4:1@0.8 F#4:1@0.75 F#4:2@0.85 A4:8@0.95');
P.hrn1.line(2, 'F#4:3@1 r:5 F#4:8@0.75');
P.hrn2.line(2, 'D4:3@1 r:5 D4:8@0.75');
P.tbn1.line(2, 'A3:3@1 r:5 A3:8@0.7');
P.tbn2.line(2, 'F#3:3@1 r:5 D3:8@0.7');
P.tuba.line(2, 'D2:3@1 r:5 D2:5@0.8 r:1 D2:2@0.85');
P.timp.hits(2, 'X.....x.....x.x.', 'D2').rows[(2 - 1) * ROW + 12].note = 'A2';
P.timp.rows[(2 - 1) * ROW + 14].note = 'A2';
P.bd.note(2, 0, 'A1', 1, 1);
P.cym.note(2, 0, 'C5', 1, 1);
cellos(2, 0.85);
P.snare.roll(2, 12, 15, 'G3', 0.4, 0.8);

// Bars 3-6: the theme in the horns.
P.hrn1.line(3, 'A3:3@1 A3:1@0.9 D4:4@1 F#4:4@1 E4:4@0.95 | D4:6@1 C#4:2@0.92 A3:8@0.95 | Bb3:4@1 A3:4@0.92 G3:4@0.95 A3:4@0.95 | D4:16@1');
P.hrn2.line(3, 'F#3:3@0.72 F#3:1@0.62 A3:4@0.72 D4:4@0.74 C#4:4@0.68 | A3:6@0.72 A3:2@0.66 E3:8@0.7 | F3:4@0.72 F3:4@0.68 E3:4@0.7 E3:4@0.7 | F#3:16@0.76');
P.tbn1.line(3, 'D3:16@0.42 | E3:16@0.42 | D3:8@0.45 E3:8@0.47 | A3:16@0.5');
P.tbn2.line(3, 'A2:16@0.42 | A2:16@0.42 | Bb2:8@0.45 C3:8@0.47 | D3:16@0.5');
kick332(P.tuba, 3, ['D2', 'D2', 'D2'], 0.6);
kick332(P.tuba, 4, ['A1', 'A1', 'A1'], 0.6);
P.tuba.line(5, 'Bb1:6@0.6 r:2 C2:4@0.58 C2:4@0.6');
kick332(P.tuba, 6, ['D2', 'D2', 'D2'], 0.66);
for (const b of [3, 4, 5, 6]) { cellos(b, 0.6); violins(b, 0.42); pad(b, 0.3); }
P.timp.note(3, 0, 'D2', 1, 0.85).note(4, 0, 'A2', 1, 0.75).note(5, 0, 'Bb2', 1, 0.7).note(5, 8, 'C3', 1, 0.75).note(6, 0, 'D2', 1, 0.85);
P.timp.roll(6, 12, 15, 'D2', 0.35, 0.8);
P.bd.note(3, 0, 'A1', 1, 0.7).note(6, 0, 'A1', 1, 0.6);
P.cym.note(3, 0, 'C5', 1, 0.8);
P.snare.hits(5, '........o.o.o.x.', 'G3').roll(6, 8, 15, 'G3', 0.35, 0.85);
// the trumpets answer the horns' long D, up the chord into the next statement
P.tpt1.line(6, 'r:8 A4:2@0.7 D5:2@0.75 F#5:2@0.8 A5:2@0.85');
P.tpt2.line(6, 'r:8 F#4:2@0.65 A4:2@0.7 D5:2@0.75 F#5:2@0.8');

// Bars 7-10: the theme an octave up in the trumpets; the horns against it.
P.tpt1.line(7, 'A4:3@0.95 A4:1@0.85 D5:4@0.96 F#5:4@1 E5:4@0.92 | D5:6@0.96 C#5:2@0.88 A4:8@0.92 | Bb4:4@0.95 A4:4@0.9 G4:4@0.92 A4:4@0.92 | D5:16@1');
P.tpt2.line(7, 'F#4:3@0.85 F#4:1@0.75 A4:4@0.86 D5:4@0.9 C#5:4@0.82 | A4:6@0.86 A4:2@0.8 E4:8@0.82 | F4:4@0.85 F4:4@0.8 E4:4@0.82 E4:4@0.82 | A4:16@0.9');
P.hrn1.line(7, 'F#4:8@0.8 E4:8@0.78 | E4:8@0.8 C#4:8@0.78 | D4:8@0.8 E4:8@0.82 | F#4:8@0.85 A4:8@0.9');
P.hrn2.line(7, 'A3:16@0.75 | A3:16@0.75 | F3:8@0.76 G3:8@0.78 | D4:16@0.82');
P.tbn1.line(7, 'F#3:16@0.7 | E3:16@0.7 | D3:8@0.72 E3:8@0.74 | F#3:16@0.78');
P.tbn2.line(7, 'D3:16@0.7 | A2:16@0.7 | Bb2:8@0.72 C3:8@0.74 | D3:16@0.78');
kick332(P.tuba, 7, ['D2', 'D2', 'D2'], 0.88);
kick332(P.tuba, 8, ['A1', 'A1', 'A1'], 0.88);
P.tuba.line(9, 'Bb1:6@0.88 r:2 C2:4@0.85 C2:4@0.88');
kick332(P.tuba, 10, ['D2', 'D2', 'D2'], 0.9);
for (const b of [7, 8, 9, 10]) { cellos(b, 0.9); violins(b, 0.62); pad(b, 0.5); }
P.timp.line(7, 'D2:1@0.9 r:5 A2:1@0.5 r:5 D2:1@0.6 r:3 | A2:1@0.85 r:5 A2:1@0.5 r:5 E2:1@0.6 r:3 | Bb2:1@0.85 r:7 C3:1@0.85 r:3 C3:1@0.6 r:3');
P.timp.note(10, 0, 'D2', 1, 0.95).roll(10, 8, 15, 'D2', 0.3, 0.9);
for (const b of [7, 8, 9]) P.snare.hits(b, 'X..x..x.X.xox.xo', 'G3', 0.85);
P.snare.hits(10, 'X.x.x.xx', 'G3', 0.85).roll(10, 8, 15, 'G3', 0.45, 0.95);
for (const b of [7, 8, 9]) P.bd.note(b, 0, 'A1', 1, 0.75).note(b, 8, 'A1', 1, 0.55);
P.bd.note(10, 0, 'A1', 1, 0.8);
P.cym.note(7, 0, 'C5', 1, 0.9).note(9, 0, 'C5', 1, 0.6).note(10, 0, 'C5', 1, 0.7);

// Bars 11-12: the lift. The call in canon, then ♭VI and ♭VII of E, hammered.
P.tbn1.line(11, 'D3:4@0.9 G3:4@0.92 B3:8@0.95');
P.tbn2.line(11, 'G2:4@0.85 D3:4@0.88 G3:8@0.9');
P.hrn1.line(11, 'r:4 A3:4@0.88 D4:4@0.9 F#4:4@0.95');
P.hrn2.line(11, 'r:4 D3:4@0.8 A3:4@0.84 D4:4@0.88');
P.tpt1.line(11, 'r:8 B4:1@0.8 B4:1@0.72 B4:1@0.76 B4:1@0.8 D5:1@0.84 D5:1@0.76 D5:1@0.8 D5:1@0.88');
P.tpt2.line(11, 'r:8 G4:1@0.75 G4:1@0.68 G4:1@0.72 G4:1@0.76 B4:1@0.8 B4:1@0.72 B4:1@0.76 B4:1@0.84');
kick332(P.tuba, 11, ['G1', 'G1', 'G1'], 0.9);
cellos(11, 0.92); violins(11, 0.7); pad(11, 0.55);
const hammer = (part, lo, hi, v) => part.line(12, `${lo}:2@${v} r:1 ${lo}:2@${v + 0.03} r:1 ${lo}:2@${v + 0.06} ${hi}:2@${v + 0.08} r:1 ${hi}:2@${v + 0.1} r:1 ${hi}:2@${v + 0.12}`);
hammer(P.tpt1, 'G4', 'A4', 0.82); hammer(P.tpt2, 'E4', 'F#4', 0.78);
hammer(P.hrn1, 'C4', 'D4', 0.8); hammer(P.hrn2, 'G3', 'A3', 0.78);
hammer(P.tbn1, 'E3', 'F#3', 0.8); hammer(P.tbn2, 'C3', 'D3', 0.8);
hammer(P.tuba, 'C2', 'D2', 0.8);
hammer(P.timp, 'C3', 'D2', 0.7);
cellos(12, 0.95); violins(12, 0.78);
P.vla.note(12, 0, 'E4', 8, 0.6).note(12, 8, 'F#4', 8, 0.65);
P.snare.hits(11, 'X..x..x.x.x.x.xx', 'G3', 0.9).roll(12, 0, 15, 'G3', 0.4, 1);
P.timp.note(11, 0, 'G2', 1, 0.9).roll(11, 8, 15, 'D2', 0.3, 0.75);
P.bd.note(11, 0, 'A1', 1, 0.85).note(12, 0, 'A1', 1, 0.7).note(12, 8, 'A1', 1, 0.75);
P.cym.note(11, 0, 'C5', 1, 0.75).note(12, 4, 'C5', 12, 1);
P.cym.last.instrument = INST_ID('swell');

// Bars 13-16: the theme in E, everything.
const THEME_E = 'B4:3@1 B4:1@0.9 E5:4@1 G#5:4@1 F#5:4@0.95 | E5:6@1 D#5:2@0.92 B4:8@0.95 | C5:4@1 B4:4@0.94 A4:4@0.95 B4:4@0.96 | E5:16@1';
P.tpt1.line(13, THEME_E);
P.hi.line(13, THEME_E.replace(/@[\d.]+/g, '@0.7'));
P.keys.line(13, 'B5:3@0.7 B5:1@0.6 E6:4@0.72 G#6:4@0.75 F#6:4@0.7 | E6:6@0.72 D#6:2@0.65 B5:8@0.7 | C6:4@0.72 B5:4@0.68 A5:4@0.68 B5:4@0.7 | E6:16@0.78');
P.tpt2.line(13, 'G#4:3@0.92 G#4:1@0.82 B4:4@0.92 E5:4@0.95 D#5:4@0.88 | B4:6@0.92 B4:2@0.85 F#4:8@0.88 | G4:4@0.92 G4:4@0.86 F#4:4@0.88 F#4:4@0.88 | B4:16@0.95');
P.hrn1.line(13, 'B3:3@1 B3:1@0.9 E4:4@1 G#4:4@1 F#4:4@0.95 | E4:6@1 D#4:2@0.92 B3:8@0.95 | C4:4@1 B3:4@0.94 A3:4@0.95 B3:4@0.96 | E4:16@1');
P.hrn2.line(13, 'G#3:3@0.9 G#3:1@0.8 B3:4@0.9 E4:4@0.92 D#4:4@0.86 | B3:6@0.9 B3:2@0.84 F#3:8@0.86 | G3:4@0.9 G3:4@0.85 F#3:4@0.86 F#3:4@0.86 | G#3:16@0.92');
P.tbn1.line(13, 'G#3:16@0.85 | F#3:16@0.85 | E3:8@0.86 F#3:8@0.88 | G#3:16@0.9');
P.tbn2.line(13, 'E3:16@0.85 | B2:16@0.85 | C3:8@0.86 D3:8@0.88 | E3:16@0.9');
kick332(P.tuba, 13, ['E2', 'E2', 'E2'], 0.95);
kick332(P.tuba, 14, ['B1', 'B1', 'B1'], 0.95);
P.tuba.line(15, 'C2:6@0.95 r:2 D2:4@0.92 D2:4@0.95');
kick332(P.tuba, 16, ['E2', 'E2', 'E2'], 0.98);
for (const b of [13, 14, 15, 16]) { cellos(b, 1); violins(b, 0.72, 68); pad(b, 0.6); }
P.timp.line(13, 'E2:1@1 r:5 E2:1@0.6 r:5 B2:1@0.65 r:3 | B2:1@0.9 r:5 B2:1@0.55 r:5 F#2:1@0.6 r:3 | C3:1@0.9 r:7 D3:1@0.9 r:7 | E2:1@1 r:5 E2:1@0.65 r:5 B2:1@0.7 r:3');
for (const b of [13, 14, 15]) P.snare.hits(b, 'X..x..x.X.xox.xo', 'G3', 1);
P.snare.hits(16, 'X..x..x.X..x..x.', 'G3', 1);
for (const b of [13, 14, 15, 16]) P.bd.note(b, 0, 'A1', 1, b === 13 ? 1 : 0.8).note(b, 8, 'A1', 1, 0.6);
P.cym.note(13, 0, 'C5', 1, 1).note(15, 0, 'C5', 1, 0.7).note(16, 0, 'C5', 1, 0.85);

// Bars 17-18: the kicks, the run to the top, the last chord and the button.
const kicks = (part, n, v) => part.line(17, `${n}:2@${v} r:1 ${n}:2@${v} r:1 ${n}:2@${v + 0.05}`);
kicks(P.hrn1, 'E4', 0.9); kicks(P.hrn2, 'B3', 0.88); kicks(P.tbn1, 'G#3', 0.9); kicks(P.tbn2, 'E3', 0.9); kicks(P.tuba, 'E2', 0.95);
P.tpt1.line(17, 'E5:2@0.92 r:1 E5:2@0.92 r:1 E5:2@0.96 B4:1@0.8 C#5:1@0.82 D#5:1@0.85 E5:1@0.88 F#5:1@0.9 G#5:1@0.93 A5:1@0.96 r:1');
P.tpt2.line(17, 'B4:2@0.9 r:1 B4:2@0.9 r:1 B4:2@0.94 G#4:1@0.78 A4:1@0.8 B4:1@0.82 C#5:1@0.85 D#5:1@0.88 E5:1@0.9 F#5:1@0.93 r:1');
P.hrn1.line(17, 'r:8 E4:8@0.8'); P.hrn2.line(17, 'r:8 B3:8@0.78'); P.tbn1.line(17, 'r:8 G#3:8@0.8'); P.tbn2.line(17, 'r:8 E3:8@0.8');
P.tuba.line(17, 'r:8 E2:8@0.85');
pad(17, 0.65);
P.timp.line(17, 'E2:1@1 r:2 E2:1@0.9 r:2 E2:1@0.95 r:1').roll(17, 8, 15, 'E2', 0.3, 0.95);
P.snare.line(17, 'G3:1@0.95 r:2 G3:1@0.9 r:2 G3:1@0.95 r:1').roll(17, 8, 15, 'G3', 0.4, 1);
P.bd.note(17, 0, 'A1', 1, 0.9).note(17, 3, 'A1', 1, 0.75).note(17, 6, 'A1', 1, 0.8);
cellos(17, 1); violins(17, 0.8, 68);
P.cym.note(17, 0, 'C5', 1, 0.8).note(17, 4, 'C5', 12, 1);
P.cym.last.instrument = INST_ID('swell');
// the last chord, held, and then the button on beat four
const last = [['tpt1', 'B5'], ['tpt2', 'G#5'], ['hrn1', 'E5'], ['hrn2', 'B4'], ['tbn1', 'G#3'], ['tbn2', 'E3'], ['tuba', 'E2'], ['hi', 'E5'], ['vla', 'G#4']];
for (const [k, n] of last) P[k].line(18, `${n}:10@1 r:2 ${n}:2@1 r:2`);
P.keys.line(18, 'E6:12@0.8 E6:4@0.85');
P.vc.line(18, 'E2:10@1 r:2 E2:2@1 r:2');
P.vln.roll(18, 0, 9, 'E5', 0.5, 0.85).line(18, 'r:12 E6:2@0.9 r:2');
P.timp.note(18, 0, 'E2', 1, 1).roll(18, 2, 10, 'E2', 0.4, 0.85).note(18, 12, 'E2', 1, 1);
P.snare.note(18, 0, 'G3', 1, 0.9).note(18, 12, 'G3', 1, 1);
P.bd.note(18, 0, 'A1', 1, 1).note(18, 12, 'A1', 1, 1);
P.cym.note(18, 0, 'C5', 1, 0.9).note(18, 12, 'C5', 1, 1);

// ── compile ─────────────────────────────────────────────────────────────────
const parts = Object.values(P);
if (parts.length > 16) throw new Error(`${parts.length} parts: a song plays sixteen channels`);
const used = [...new Set(parts.flatMap((p) => p.rows.filter(Boolean).map((s) => s.instrument)))].sort();
for (const id of used) if (!Object.keys(INSTRUMENTS).some((k) => INST_ID(k) === id)) throw new Error(`no instrument ${id}`);
for (const p of parts) p.rows.forEach((s, i) => { if (s && i + (s.len || 1) > ROWS) throw new Error(`${p.key}: ${s.note} at row ${i} runs past the end`); });

export const song = {
  id: SONG_ID,
  name: SONG_NAME,
  category: 'theme',
  tempo: TEMPO,
  loop_start: 0,
  loop_end: 0,
  priority: 6,
  enabled: 1,
  instrument_ids: used,
  channels: parts.map((p) => p.rows),
  channel_pan: parts.map((p) => p.pan),
};
// Every layer names its waveform, a noise layer too (where it's never heard): the Audio tab's
// Rack shows the row's waveform on a layer that names none and saves it there, so a row whose
// layers all name theirs is one the Rack opens and saves unchanged.
export const instruments = Object.entries(INSTRUMENTS).map(([key, def]) => ({
  id: INST_ID(key), name: def.name, category: 'orchestral', waveform: def.waveform, enabled: 1, sample_id: null,
  config: { layers: def.layers.map((l) => ({ waveform: def.waveform, ...l })) },
}));

// ── write ───────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = [
    ...instruments.map((r) => [`content/audio_instruments/${r.id}.json`, r]),
    [`content/audio_songs/${SONG_ID}.json`, song],
  ];
  let stale = 0;
  for (const [rel, row] of files) {
    const p = path.join(ROOT, rel);
    const want = canonicalJson(row);
    const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (have === want) continue;
    stale++;
    if (CHECK) console.error(`✗ ${rel} is behind scripts/content/build-ksab-theme.mjs`);
    else { fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`); }
  }
  if (CHECK && stale) process.exit(1);
  const notes = parts.reduce((n, p) => n + p.rows.filter(Boolean).length, 0);
  console.log(`${CHECK ? '✓ up to date' : '✓ built'}: ${SONG_NAME}, ${parts.length} channels, ${notes} notes, ${BARS} bars at ${TEMPO} bpm (${(ROWS * 60 / TEMPO / 4).toFixed(1)} s), ${instruments.length} instruments`);
}
