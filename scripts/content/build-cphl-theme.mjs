// The KSAB-7 Sports theme for Cluster Puck: written here as a score, compiled to a tracker song.
//
//   node scripts/content/build-cphl-theme.mjs           write the instrument and song files
//   node scripts/content/build-cphl-theme.mjs --check   fail if the files are behind this script
//
// The song plays under the CPhL's title card, once (`@theme` in data/scripts/hockey.bsm), and the
// card holds for it. scripts/audio/song-render.mjs renders it to a WAV to listen to. The score
// format is build-ksab-theme.mjs's, which wrote Deadball's.
//
// THE SOUND. The CPhL sounds like a 16-bit console hockey cartridge, FM all the way down
// (docs/systems-hockey-sound.md), so the network's hockey theme is that machine's idea of an
// arena band: FM brass, a slap bass, a power chord, an arena organ, a bell running sixteenths,
// and drums made of noise and falling sines. Two things come from Deadball's theme, so the two
// sound like one network: the call (5 5 5 1, which the network's mark goes up on) and the
// ending (♭VI, ♭VII, I). The orchestra's timpani and cymbals play under both.
//
// THE HORN. The goal horn (hk-goal-horn in client/shared/hockey-sfx.js) is 208 Hz, which is A♭3,
// so the theme is in A♭ and its relative minor. The horn sounds twice: with the lamp in the
// CPhL's own open, and under the last chord, where the band stops and leaves it on its own.
//
// THE TUNE grows out of the call. The call rises a fourth, 5 to 1, and the tune opens on the same
// leap: C F E♭ D♭ C in F minor, E♭ A♭ G F E♭ in A♭.
//
// THE FORM (150 bpm, 16 bars, 25.6 seconds; a row is a tenth of a second):
//   1      a fill on the toms, the hit as the CPhL's mark lands (row 6), a cymbal roll, the horn
//          with the lamp (row 15)
//   2      the band under the horn, D♭ to E♭
//   3      the network's call in A♭
//   4-7    the tune in F minor, the brass over a galloping bass and the power chord
//   8-9    the organ's break: stabs, then a climb with the bass, the timpani rolling under it
//   10-13  the tune in A♭, everything, the bells running sixteenths over it
//   14     ♭VI and ♭VII, in kicks
//   15     A♭ and the horn; the band stops, the horn holds alone, then the button
//   16     the tails
//
// FM, AND THE TWO RATIOS IT CAN'T USE. SIREN modulates a carrier's frequency, so a modulator at the
// carrier's own pitch (ratio 1) or half of it (0.5) puts a sideband at 0 Hz: a DC offset that
// wanders as the index moves. Every FM carrier here is a sine (a sawtooth's own harmonics would
// line up with any whole ratio and do the same), and every ratio is 2 or 3, 1.5 on a carrier an
// octave up (which is 3 against the note), or inharmonic.
//
// A drum's pitch drop is a `pitchBend`, which is in Hz, so a drum that drops is played on one note
// (the kick on D3, the snare on E3). The toms play at several, so theirs is an envelope mod.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import { instruments as orchestra } from './build-ksab-theme.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

export const SONG_NAME = 'ksab7_cphl_theme';
const SONG_ID = `aud_song_${SONG_NAME}`;
export const TEMPO = 150;
const ROW = 16;                 // rows a bar: a row is a 16th
export const BARS = 16;
const ROWS = BARS * ROW;
// The song's level, under every step's vol and every part's fader.
const MASTER = 1;

// ── pitch ───────────────────────────────────────────────────────────────────
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const midi = (n) => { const m = /^([A-G][#b]?)(-?\d)$/.exec(n); if (!m || PC[m[1]] == null) throw new Error(`bad note ${n}`); return (+m[2] + 1) * 12 + PC[m[1]]; };
const nameOf = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
// the lowest note at or above `floor` whose pitch class is `pc`
const above = (pc, floor) => floor + ((PC[pc] - (floor % 12)) + 12) % 12;

// ── the band ────────────────────────────────────────────────────────────────
const env = (a, d, s, r, curve) => ({ a, d, s, r, ...(curve ? { curve } : {}) });
const lp = (freq, q = 0.8) => ({ type: 'lowpass', freq, q });
const bp = (freq, q = 0.8) => ({ type: 'bandpass', freq, q });
const hp = (freq, q = 0.7) => ({ type: 'highpass', freq, q });
// a modulator `ratio` times the carrier, its index falling from `index` to `indexEnd` over `time`
const fm = (ratio, index, indexEnd, time, more = {}) => ({ ratio, index, indexEnd, time, ...more });
// vibrato that arrives once the note has settled
const vib = (id, rate, cents, fade) => ({ id, type: 'lfo', wave: 'sine', rate, fade, to: [{ param: 'pitch', amount: cents }] });
// a struck pitch falling to rest
const bend = (id, cents, d) => ({ id, type: 'env', a: 0.001, d, s: 0, r: 0.05, to: [{ param: 'pitch', amount: cents }] });

const BAND = {
  // The lead: a sine with a modulator an octave up (the odd partials, and the blat as the index
  // falls), the same an octave higher against a modulator at 3:2 (the even ones), one more at 3
  // for the 4th and 5th, and a sawtooth under them for body. Its echo is an eighth note, the way
  // the cartridges faked a hall.
  lead: { name: 'FM: Brass lead', waveform: 'sine', layers: [
    { waveform: 'sine', detune: -3, gain: 0.17, adsr: env(0.012, 0.22, 0.72, 0.12), fm: fm(2, 2.4, 1.5, 0.12, { bright: 0.8 }),
      mods: [vib('vb', 5.6, 9, 0.45)], echo: { mix: 0.14, delay: 0.2, feedback: 0.28 } },
    { waveform: 'sine', tune: 12, detune: 4, gain: 0.12, adsr: env(0.016, 0.22, 0.65, 0.12), fm: fm(1.5, 1.8, 1.1, 0.1, { bright: 0.8 }) },
    { waveform: 'sine', detune: 2, gain: 0.1, adsr: env(0.014, 0.22, 0.68, 0.12), fm: fm(3, 1.6, 1, 0.1, { bright: 0.8 }) },
    { waveform: 'sawtooth', detune: 6, gain: 0.05, adsr: env(0.02, 0.3, 0.7, 0.14), filter: lp(2400, 0.7) },
  ] },
  // The section: brass like the lead's, a modulator at 3 for a full fundamental, darker and slower
  // to speak, for the harmony and the pads.
  brass: { name: 'FM: Brass section', waveform: 'sine', layers: [
    { waveform: 'sine', detune: -5, gain: 0.16, adsr: env(0.02, 0.3, 0.8, 0.16), fm: fm(3, 1.7, 0.9, 0.15, { bright: 0.6 }) },
    { waveform: 'sine', tune: 12, detune: 5, gain: 0.07, adsr: env(0.025, 0.3, 0.75, 0.16), fm: fm(1.5, 1.2, 0.5, 0.12) },
    { waveform: 'sawtooth', detune: 7, gain: 0.06, adsr: env(0.03, 0.3, 0.8, 0.18), filter: lp(1600, 0.7) },
  ] },
  // The guitar there's no guitar for: a root, a fifth and an octave, each a sine driven hard by
  // a modulator at 3, which is a buzz, over a sawtooth.
  power: { name: 'FM: Power chord', waveform: 'sine', layers: [
    { waveform: 'sine', detune: -6, gain: 0.09, adsr: env(0.004, 0.35, 0.6, 0.07), fm: fm(3, 3, 1.8, 0.2) },
    { waveform: 'sine', tune: 7, detune: 5, gain: 0.08, adsr: env(0.004, 0.35, 0.6, 0.07), fm: fm(3, 2.6, 1.6, 0.2) },
    { waveform: 'sine', tune: 12, gain: 0.05, adsr: env(0.004, 0.3, 0.55, 0.07), fm: fm(2, 2, 1, 0.2) },
    { waveform: 'sawtooth', detune: 8, gain: 0.05, adsr: env(0.004, 0.3, 0.6, 0.07), filter: lp(1800, 1.2) },
  ] },
  // The slap bass: the twang is the index falling in 80 ms; an octave up at 3:2 pops on the
  // attack; a plain sine under it is the weight, kept low so the bass is heard in its harmonics.
  bass: { name: 'FM: Slap bass', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.3, adsr: env(0.002, 0.3, 0.5, 0.06, 'exp'), fm: fm(3, 2.4, 0.5, 0.08, { bright: 1 }) },
    { waveform: 'sine', tune: 12, gain: 0.12, adsr: env(0.0015, 0.12, 0.25, 0.05, 'exp'), fm: fm(1.5, 1.8, 0.2, 0.05) },
    { waveform: 'sine', gain: 0.1, adsr: env(0.003, 0.25, 0.7, 0.06) },
  ] },
  // The arena organ: drawbars (8', 4', 2 2/3', 2' and a little 16'), a fast Leslie, a percussion
  // on the 2 2/3' that dies at once, and a key click.
  organ: { name: 'FM: Arena organ', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.105, adsr: env(0.006, 0.05, 1, 0.07), tremolo: { rate: 6.7, depth: 0.08 } },
    { waveform: 'sine', tune: 12, gain: 0.077, adsr: env(0.006, 0.05, 1, 0.07), tremolo: { rate: 6.7, depth: 0.08 } },
    { waveform: 'sine', tune: 19, gain: 0.056, adsr: env(0.006, 0.05, 1, 0.07) },
    { waveform: 'sine', tune: 24, gain: 0.05, adsr: env(0.006, 0.05, 1, 0.07) },
    { waveform: 'sine', tune: -12, gain: 0.035, adsr: env(0.006, 0.05, 1, 0.07) },
    { waveform: 'sine', tune: 19, gain: 0.085, adsr: env(0.001, 0.3, 0, 0.05, 'exp') },
    { noiseMix: 1, gain: 0.045, adsr: env(0.0005, 0.004, 0, 0.003), filter: bp(2600, 0.8), noiseSeed: 211 },
  ] },
  // The bell: a modulator at 3 whose index is gone in 100 ms, and a tick two octaves up.
  bell: { name: 'FM: Arp bell', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.2, adsr: env(0.001, 0.25, 0, 0.06, 'exp'), fm: fm(3, 1.5, 0.1, 0.1, { bright: 1 }) },
    { waveform: 'sine', tune: 24, gain: 0.04, adsr: env(0.001, 0.05, 0, 0.03, 'exp') },
  ] },
  // The goal horn, as hockey-sfx.js builds it: the note and its 2nd, 3rd and 4th partials a hair
  // apart, a modulator at 2 on the lower two (the blat, opening and settling), a little drive.
  horn: { name: 'FM: Goal horn', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.12, adsr: env(0.02, 0.12, 0.9, 0.22), fm: fm(2, 1.6, 0.8, 0.12), drive: 0.1, filter: lp(2400, 0.5) },
    { waveform: 'sine', tune: 12, detune: 2.5, gain: 0.13, adsr: env(0.026, 0.15, 0.85, 0.2), fm: fm(2, 0.9, 0.45, 0.15) },
    { waveform: 'sine', tune: 19.02, detune: -1.4, gain: 0.08, adsr: env(0.03, 0.18, 0.8, 0.2) },
    { waveform: 'sine', tune: 24, detune: 1.9, gain: 0.05, adsr: env(0.034, 0.2, 0.7, 0.18) },
  ] },
  // The kick, played on D3: a sine falling to 48 Hz, a beater click from an inharmonic modulator
  // gone in 12 ms, and a breath of noise.
  kick: { name: 'FM: Kick', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.42, adsr: env(0.001, 0.2, 0, 0.05, 'exp'), pitchBend: { to: 48, time: 0.07 } },
    { waveform: 'sine', tune: 12, gain: 0.22, adsr: env(0.0005, 0.018, 0, 0.01, 'exp'), fm: fm(1.41, 3.5, 0, 0.012) },
    { noiseMix: 1, gain: 0.08, adsr: env(0.0005, 0.006, 0, 0.004, 'exp'), filter: bp(3200, 0.7), noiseSeed: 223 },
  ] },
  // The snare, played on E3: the wires, a sizzle over them, and a body with a crack in it.
  snare: { name: 'FM: Snare', waveform: 'sine', layers: [
    { noiseMix: 1, gain: 0.55, adsr: env(0.0008, 0.18, 0, 0.06, 'exp'), filter: bp(2400, 0.55), noiseSeed: 227 },
    { noiseMix: 1, gain: 0.22, adsr: env(0.0005, 0.09, 0, 0.04, 'exp'), filter: hp(6500, 0.7), noiseSeed: 229 },
    { waveform: 'sine', gain: 0.35, adsr: env(0.0008, 0.08, 0, 0.04, 'exp'), fm: fm(1.41, 1.4, 0.1, 0.03), pitchBend: { to: 140, time: 0.04 } },
  ] },
  // The hat: noise over 7 kHz and a square rung by an inharmonic modulator, both gone in 40 ms.
  hat: { name: 'FM: Hi-hat', waveform: 'square', layers: [
    { noiseMix: 1, gain: 0.3, adsr: env(0.0005, 0.04, 0, 0.02, 'exp'), filter: hp(7000, 0.7), noiseSeed: 233 },
    { waveform: 'square', gain: 0.03, adsr: env(0.0005, 0.03, 0, 0.02, 'exp'), filter: hp(5000, 0.7), fm: fm(1.47, 2.5, 2, 0.05) },
  ] },
  // The toms: a membrane's inharmonic ring (1.59) struck and settling, the pitch falling three
  // semitones, and the stick.
  tom: { name: 'FM: Toms', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.42, adsr: env(0.001, 0.35, 0, 0.08, 'exp'), fm: fm(1.59, 1.3, 0.05, 0.06), mods: [bend('dr', 300, 0.12)] },
    { noiseMix: 1, gain: 0.07, adsr: env(0.0005, 0.025, 0, 0.02, 'exp'), filter: bp(1500, 0.9), noiseSeed: 239 },
  ] },
};
const ORCH = new Map(orchestra.map((r) => [r.id, r]));
// `fm_…` is a row this script writes; `orch_…` is the orchestra's, written by build-ksab-theme.mjs
const INST_ID = (key) => `aud_inst_${key}`;
const KICK = 'D3', SNARE = 'E3', HAT = 'C6', CYM = 'C5';

// ── the score ───────────────────────────────────────────────────────────────
// A part is one channel: one note at a time. `line(bar, text)` reads tokens from a bar:
//   NOTE:LEN[@VOL]   a note `len` rows long (Ab4:3, C6:8@0.9)
//   r:LEN            a rest
//   -:LEN            the note before held LEN rows more (across a bar line)
//   |                a bar line, which has to fall on one
// A note plays the part's instrument unless it's given another. A part's fader scales every vol it
// writes, so the mix is one number a channel.
class Part {
  constructor(key, inst, pan, fader = 1) { this.key = key; this.inst = inst; this.pan = pan; this.fader = fader; this.rows = new Array(ROWS).fill(null); }
  note(bar, row, note, len = 1, vol = 0.8, inst = this.inst) {
    const i = (bar - 1) * ROW + row;
    if (i < 0 || i >= ROWS) throw new Error(`${this.key}: bar ${bar} row ${row} is outside the song`);
    if (this.rows[i]) throw new Error(`${this.key}: bar ${bar} row ${row} already has ${this.rows[i].note}`);
    const n = typeof note === 'number' ? nameOf(note) : note;
    midi(n);
    this.rows[i] = { note: n, instrument: INST_ID(inst), vol: +(Math.min(1, vol * this.fader) * MASTER).toFixed(3), ...(len > 1 ? { len } : {}) };
    this.last = this.rows[i];
    return this;
  }
  line(bar, text, vol = 0.8, inst = this.inst) {
    let at = 0;
    for (const tok of text.trim().split(/\s+/)) {
      if (tok === '|') { if (at % ROW) throw new Error(`${this.key}: bar line at row ${at} in "${text}"`); continue; }
      const m = /^([A-G][#b]?-?\d|r|-):(\d+)(?:@([\d.]+))?$/.exec(tok);
      if (!m) throw new Error(`${this.key}: bad token ${tok}`);
      const len = +m[2];
      if (m[1] === '-') { if (!this.last) throw new Error(`${this.key}: tie with nothing to hold`); this.last.len = (this.last.len || 1) + len; }
      else if (m[1] !== 'r') this.note(bar + Math.floor(at / ROW), at % ROW, m[1], len, m[3] != null ? +m[3] : vol, inst);
      at += len;
    }
    return this;
  }
  // a drum pattern for one bar: X loud, x normal, o soft, . nothing
  hits(bar, pattern, note, scale = 1) {
    const V = { X: 0.9, x: 0.62, o: 0.36 };
    const cells = [...pattern.replace(/\s/g, '')];
    if (cells.length !== ROW) throw new Error(`${this.key}: bar ${bar} pattern "${pattern}" isn't ${ROW} rows`);
    cells.forEach((c, row) => { if (V[c]) this.note(bar, row, note, 1, V[c] * scale); });
    return this;
  }
  // a roll: every row from..to on one note, the level going from v0 to v1
  roll(bar, from, to, note, v0, v1, inst = this.inst) {
    for (let r = from; r <= to; r++) this.note(bar + Math.floor(r / ROW), r % ROW, note, 1, v0 + (v1 - v0) * (to === from ? 1 : (r - from) / (to - from)), inst);
    return this;
  }
}

// The stage, from the house: the brass across the middle, the guitar left and the organ right,
// the bells left of centre, the kit in the middle with the hat to the right.
const P = {
  lead: new Part('lead', 'fm_lead', 0.06), harm: new Part('harm', 'fm_brass', -0.2), sect: new Part('sect', 'fm_brass', 0.24),
  gtr: new Part('gtr', 'fm_power', -0.38), bass: new Part('bass', 'fm_bass', 0),
  org1: new Part('org1', 'fm_organ', 0.4), org2: new Part('org2', 'fm_organ', 0.3),
  bell: new Part('bell', 'fm_bell', -0.32), horn: new Part('horn', 'fm_horn', 0, 0.75), timp: new Part('timp', 'orch_timpani', -0.14, 0.85),
  kick: new Part('kick', 'fm_kick', 0, 0.9), snare: new Part('snare', 'fm_snare', 0.04), hat: new Part('hat', 'fm_hat', 0.3, 1.3),
  cym: new Part('cym', 'orch_crash', -0.06, 0.85), tom: new Part('tom', 'fm_tom', -0.18),
};

// The harmony, a chord a bar.
const CH = {
  Ab: ['Ab', 'C', 'Eb'], Db: ['Db', 'F', 'Ab'], Eb: ['Eb', 'G', 'Bb'], Fm: ['F', 'Ab', 'C'], E: ['E', 'G#', 'B'], Gb: ['Gb', 'Bb', 'Db'],
};
// The bass's gallop under the tune in F minor: the root, an octave up on the backbeats, the fifth
// to finish. The power chord plays every one of its notes, on the root.
const GALLOP = [[0, 2, 0, 1], [2, 1, 0, 0.7], [3, 1, 0, 0.74], [4, 2, 12, 0.9], [6, 2, 0, 0.8], [8, 2, 0, 0.95], [10, 1, 0, 0.7], [11, 1, 0, 0.74], [12, 2, 12, 0.9], [14, 2, 7, 0.86]];
function gallop(bar, root, level) {
  const lo = midi(`${root}2`), g = midi(`${root}3`);
  for (const [row, len, up, v] of GALLOP) {
    P.bass.note(bar, row, lo + up, len, level * v);
    P.gtr.note(bar, row, g, len, level * (len > 1 ? 0.88 : 0.62));
  }
}
// Under the tune in A♭: the bass in eighths with the octave on the backbeats, the power chord
// pushing 3-3-2 and then eighths, and the organ on the offbeats.
function drive(bar, root, bassRoot, level, { organ = true } = {}) {
  const lo = midi(`${bassRoot}2`), g = midi(`${root}3`);
  [0, 2, 4, 6, 8, 10, 12, 14].forEach((row, i) => P.bass.note(bar, row, lo + (row % 8 === 4 ? 12 : 0), 2, level * [1, 0.74, 0.88, 0.76, 0.95, 0.74, 0.88, 0.8][i]));
  [[0, 3], [3, 3], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]].forEach(([row, len], i) => P.gtr.note(bar, row, g, len, level * (i < 3 ? 0.9 : 0.72)));
  if (!organ) return;
  // the chord's lower two notes up from G4, under the section
  const [a, b] = CH[CHORD[bar]].map((pc) => above(pc, 67)).sort((x, y) => x - y);
  for (const row of [2, 6, 10, 14]) { P.org1.note(bar, row, b, 2, level * 0.5); P.org2.note(bar, row, a, 2, level * 0.45); }
}
// The bells: the chord's three notes up from C6, cycled in sixteenths, so the cell of three runs
// across the bar's groups of four.
function bells(bar, level) {
  const cell = CH[CHORD[bar]].map((pc) => above(pc, 84)).sort((x, y) => x - y);
  for (let i = 0; i < ROW; i++) P.bell.note(bar, i, cell[i % 3], 1, level * (i % 4 === 0 ? 1 : 0.68));
}
const CHORD = { 10: 'Ab', 11: 'Eb', 12: 'Fm', 13: 'Db' };

// Bar 1: a fill on the toms under the sheet's wipe; the hit as the mark lands; a cymbal roll under
// the wordmark; the horn with the lamp, a sixteenth before the bar.
P.tom.line(1, 'Ab3:1@0.5 Ab3:1@0.55 F3:1@0.62 F3:1@0.7 Db3:1@0.8 Db3:1@0.92');
P.kick.note(1, 6, KICK, 1, 1).note(1, 15, KICK, 1, 1);
P.cym.note(1, 6, CYM, 1, 1).note(1, 7, CYM, 8, 0.75, 'orch_swell').note(1, 15, CYM, 1, 0.95);
P.timp.note(1, 6, 'F2', 1, 0.85);
P.bass.note(1, 6, 'F2', 9, 1);
P.gtr.note(1, 6, 'F3', 9, 0.95);
P.lead.note(1, 6, 'C5', 3, 1); P.harm.note(1, 6, 'Ab4', 3, 0.95); P.sect.note(1, 6, 'F4', 3, 0.95);
P.snare.roll(1, 9, 14, SNARE, 0.22, 0.8);
P.horn.note(1, 15, 'Ab3', 13, 1);

// Bar 2: the band under the horn, D♭ to E♭, the drums building into the call.
P.bass.line(2, 'Db2:2@0.8 Db2:2@0.7 Db2:2@0.72 Db2:2@0.75 Eb2:2@0.8 Eb2:2@0.82 Eb2:2@0.86 Eb2:2@0.9');
P.gtr.line(2, 'Db3:8@0.7 Eb3:8@0.76');
P.kick.hits(2, 'x...x...x...x.x.', KICK);
P.snare.roll(2, 8, 15, SNARE, 0.3, 0.95);
P.timp.roll(2, 8, 15, 'Eb2', 0.18, 0.56);

// Bar 3: the network's call, as Deadball's: the hit, then 5 5 5 1.
P.lead.line(3, 'Ab5:3@1 r:1 Eb5:1@0.85 Eb5:1@0.8 Eb5:2@0.9 Ab5:8@1');
P.harm.line(3, 'Eb5:3@0.95 r:1 C5:1@0.8 C5:1@0.75 C5:2@0.85 Eb5:8@0.95');
P.sect.line(3, 'C5:3@0.95 r:5 Ab4:8@0.8');
P.bell.line(3, 'Ab6:3@0.6 r:1 Eb6:1@0.5 Eb6:1@0.46 Eb6:2@0.55 Ab6:8@0.66');
P.gtr.line(3, 'Ab3:3@1 r:5 Ab3:8@0.85');
P.bass.line(3, 'Ab2:3@1 r:5 Ab2:4@0.85 G2:4@0.85');
P.timp.line(3, 'Ab2:1@0.95 r:3 Eb2:1@0.6 Eb2:1@0.55 Eb2:1@0.65 r:1 Ab2:1@0.85 r:7');
P.kick.hits(3, 'X.......x.......', KICK);
P.snare.hits(3, 'X...o.x.X.......', SNARE);
P.cym.note(3, 0, CYM, 1, 1).note(3, 8, CYM, 1, 0.55);
P.tom.line(3, 'r:12 Ab3:1@0.65 F3:1@0.72 Db3:1@0.82 Db3:1@0.95');

// Bars 4-7: the tune in F minor, the brass over the gallop; the section comes in under it for
// the second half.
P.lead.line(4, 'C5:4@0.95 F5:4@1 Eb5:3@0.9 Db5:3@0.88 C5:2@0.9 | Ab5:6@1 F5:2@0.9 Eb5:4@0.9 Db5:4@0.88 | Bb4:4@0.92 Eb5:4@0.98 Db5:3@0.9 C5:3@0.88 Bb4:2@0.88 | Ab4:4@0.9 C5:4@0.95 F5:8@1');
P.harm.line(4, 'Ab4:16@0.5 | F4:16@0.5 | G4:16@0.52 | Ab4:16@0.55');
P.sect.line(6, 'Eb4:16@0.42 | C4:8@0.46 F4:8@0.5');
gallop(4, 'F', 0.85); gallop(5, 'Db', 0.85); gallop(6, 'Eb', 0.88); gallop(7, 'F', 0.9);
for (const b of [4, 5, 6, 7]) {
  P.kick.hits(b, 'X.....x.X.x.....', KICK);
  P.hat.hits(b, 'x.o.x.o.x.o.x.o.', HAT);
}
for (const b of [4, 5, 6]) P.snare.hits(b, '....X.......X...', SNARE);
P.snare.hits(7, '....X.......X.xX', SNARE);
P.cym.note(4, 0, CYM, 1, 0.9).note(6, 0, CYM, 1, 0.6);

// Bars 8-9: the organ's break. Stabs on D♭, three and a held one; stabs on E♭ and a climb to the
// dominant's top with the bass under it, the timpani rolling and the cymbal rising into the tune.
P.org1.line(8, 'Ab5:2@0.92 r:1 Ab5:2@0.85 r:1 Ab5:2@0.9 Ab5:6@0.95 r:2 | Bb5:2@0.92 r:1 Bb5:2@0.85 r:1 Bb5:2@0.9 C6:2@0.85 Db6:2@0.88 D6:2@0.92 Eb6:2@1');
P.org2.line(8, 'F5:2@0.85 r:1 F5:2@0.8 r:1 F5:2@0.85 F5:6@0.9 r:2 | G5:2@0.85 r:1 G5:2@0.8 r:1 G5:2@0.85 Ab5:2@0.8 Bb5:2@0.82 B5:2@0.86 C6:2@0.92');
P.bass.line(8, 'Db2:2@0.95 r:1 Db2:2@0.85 r:1 Db2:2@0.9 Db2:6@0.95 r:2 | Eb2:2@0.95 r:1 Eb2:2@0.85 r:1 Eb2:2@0.9 C3:2@0.85 Db3:2@0.88 D3:2@0.92 Eb3:2@1');
P.gtr.line(8, 'Db3:2@0.9 r:1 Db3:2@0.8 r:1 Db3:2@0.85 Db3:6@0.9 r:2 | Eb3:2@0.9 r:1 Eb3:2@0.8 r:1 Eb3:2@0.85 r:8');
P.kick.hits(8, 'X..X..X.X.......', KICK).hits(9, 'X..X..X.X.x.X.x.', KICK);
P.snare.hits(8, '......X.....x.X.', SNARE).hits(9, 'x..x..X.........', SNARE).roll(9, 8, 15, SNARE, 0.35, 1);
P.hat.hits(8, 'x...x...x...x...', HAT);
P.timp.note(8, 0, 'Db2', 1, 0.7).roll(9, 8, 15, 'Eb2', 0.2, 0.62);
P.cym.note(8, 0, CYM, 1, 0.8).note(9, 8, CYM, 8, 0.8, 'orch_swell');

// Bars 10-13: the tune in A♭, the section in thirds under the lead, the bells over it.
P.lead.line(10, 'Eb5:4@0.95 Ab5:4@1 G5:3@0.92 F5:3@0.9 Eb5:2@0.92 | Bb5:6@1 Ab5:2@0.9 G5:4@0.92 Eb5:4@0.9 | Ab5:4@0.95 C6:4@1 Bb5:3@0.92 Ab5:3@0.9 G5:2@0.9 | F5:6@0.95 Eb5:2@0.88 F5:4@0.92 G5:4@0.95');
P.harm.line(10, 'C5:4@0.8 Eb5:4@0.85 Eb5:3@0.8 Db5:3@0.78 C5:2@0.8 | G5:6@0.85 F5:2@0.78 Eb5:4@0.8 Bb4:4@0.78 | F5:4@0.8 Ab5:4@0.85 G5:3@0.8 F5:3@0.78 Eb5:2@0.78 | Db5:6@0.8 C5:2@0.75 Db5:4@0.78 Eb5:4@0.82');
P.sect.line(10, 'Ab4:16@0.55 | G4:16@0.55 | Ab4:16@0.55 | F4:16@0.58');
drive(10, 'Ab', 'Ab', 0.92); drive(11, 'Eb', 'G', 0.92); drive(12, 'F', 'F', 0.94); drive(13, 'Db', 'Db', 0.96);
for (const b of [10, 11, 12, 13]) {
  bells(b, 0.7);
  P.kick.hits(b, 'X..x..x.X..x..x.', KICK);
  P.hat.hits(b, 'xoxoxoxoxoxoxoxo', HAT, 0.9);
}
for (const b of [10, 11, 12]) P.snare.hits(b, '....X.......X..o', SNARE);
P.snare.hits(13, '....X.......XxXX', SNARE);
P.cym.note(10, 0, CYM, 1, 1).note(12, 0, CYM, 1, 0.7);
P.timp.note(10, 0, 'Ab2', 1, 0.75).note(12, 0, 'F2', 1, 0.6);

// Bar 14: ♭VI and ♭VII, three kicks each, everyone; the lead climbs G♯ to B♭ to the C it lands on.
const kicks = (part, a, b, v) => part.line(14, `${a}:2@${v} r:1 ${a}:2@${v} r:1 ${a}:2@${v + 0.04} ${b}:2@${v + 0.02} r:1 ${b}:2@${v + 0.02} r:1 ${b}:2@${v + 0.06}`);
kicks(P.lead, 'G#5', 'Bb5', 0.88); kicks(P.harm, 'E5', 'Gb5', 0.84); kicks(P.sect, 'B4', 'Db5', 0.8);
kicks(P.gtr, 'E3', 'Gb3', 0.86); kicks(P.bass, 'E2', 'Gb2', 0.9);
kicks(P.org1, 'B5', 'Db6', 0.76); kicks(P.org2, 'G#5', 'Bb5', 0.72);
kicks(P.bell, 'E6', 'Gb6', 0.6); kicks(P.timp, 'E2', 'Gb2', 0.65);
P.kick.hits(14, 'X..X..X.X..X..X.', KICK);
P.snare.hits(14, 'X..x..X.X..x..X.', SNARE);
P.cym.note(14, 0, CYM, 1, 0.9).note(14, 8, CYM, 1, 0.9);

// Bar 15: A♭, and the horn. The band holds the chord, stops, leaves the horn on its own for an
// eighth, and comes back for the button on beat four.
for (const [k, n, v] of [['lead', 'C6', 0.76], ['harm', 'Ab5', 0.76], ['sect', 'Eb5', 0.76], ['gtr', 'Ab3', 0.76], ['bass', 'Ab2', 0.8], ['org1', 'Eb5', 0.56], ['org2', 'C5', 0.56]]) {
  P[k].line(15, `${n}:10@${v} r:2 ${n}:2@${+(v + 0.1).toFixed(2)} r:2`);
}
P.horn.note(15, 0, 'Ab3', 14, 1);
P.bell.line(15, 'Ab6:12@0.75 Ab6:4@0.8');
// (the chord's drums are softer than the button's: every attack in the band lands on its first
// millisecond, which Chromium renders 0.1 hotter than the offline renderer does)
P.timp.note(15, 0, 'Ab2', 1, 0.7).roll(15, 2, 9, 'Ab2', 0.25, 0.55).note(15, 12, 'Ab2', 1, 0.85);
P.kick.note(15, 0, KICK, 1, 0.78).note(15, 12, KICK, 1, 0.9);
P.snare.note(15, 0, SNARE, 1, 0.68).note(15, 12, SNARE, 1, 1);
P.cym.note(15, 0, CYM, 1, 0.82).note(15, 12, CYM, 1, 1);

// ── compile ─────────────────────────────────────────────────────────────────
const parts = Object.values(P);
if (parts.length > 16) throw new Error(`${parts.length} parts: a song plays sixteen channels`);
const used = [...new Set(parts.flatMap((p) => p.rows.filter(Boolean).map((s) => s.instrument)))].sort();
const OWN = Object.keys(BAND).map((k) => INST_ID(`fm_${k}`));
for (const id of used) if (!OWN.includes(id) && !ORCH.has(id)) throw new Error(`no instrument ${id}`);
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
// The rows this script writes. Every layer names its waveform, a noise layer too (where it's never
// heard): the Audio tab's Rack shows the row's waveform on a layer that names none and saves it
// there, so a row whose layers all name theirs is one the Rack opens and saves unchanged.
export const band = Object.entries(BAND).map(([key, def]) => ({
  id: INST_ID(`fm_${key}`), name: def.name, category: 'fm', waveform: def.waveform, enabled: 1, sample_id: null,
  config: { layers: def.layers.map((l) => ({ waveform: def.waveform, ...l })) },
}));
// Every instrument the song plays: the band, and the orchestra's timpani and cymbals.
export const instruments = [...band, ...used.filter((id) => ORCH.has(id)).map((id) => ORCH.get(id))];

// ── write ───────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = [
    ...band.map((r) => [`content/audio_instruments/${r.id}.json`, r]),
    [`content/audio_songs/${SONG_ID}.json`, song],
  ];
  let stale = 0;
  for (const [rel, row] of files) {
    const p = path.join(ROOT, rel);
    const want = canonicalJson(row);
    const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (have === want) continue;
    stale++;
    if (CHECK) console.error(`✗ ${rel} is behind scripts/content/build-cphl-theme.mjs`);
    else { fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`); }
  }
  if (CHECK && stale) process.exit(1);
  const notes = parts.reduce((n, p) => n + p.rows.filter(Boolean).length, 0);
  console.log(`${CHECK ? '✓ up to date' : '✓ built'}: ${SONG_NAME}, ${parts.length} channels, ${notes} notes, ${BARS} bars at ${TEMPO} bpm (${(ROWS * 60 / TEMPO / 4).toFixed(1)} s), ${band.length} instruments of its own`);
}
