// The Tonight Show's theme, second take: a late-night band open, funk-jazz rather than fanfare.
//
//   node scripts/content/build-tonight-theme-2.mjs           write the instruments and the song
//   node scripts/content/build-tonight-theme-2.mjs --check   fail if the files are behind this script
//   node scripts/audio/song-render.mjs --module scripts/content/build-tonight-theme-2.mjs --wav x.wav
//
// THE BRIEF. A late-night house band, not an orchestra: a tenor sax with a bluesy hook over a
// greasy groove, a horn section answering it, fingered electric bass, Rhodes and Hammond
// comping, a muted funk guitar and a kit with ghost notes on the snare. Medium-up, swung.
//
// THE SWING. The tracker plays a row as a sixteenth of the song's `tempo`. Six rows a beat
// lets a beat split in thirds, so a swung eighth is rows 0 and 4 and a swung sixteenth pair
// is 0 and 2 (or 3 and 5). The song's `tempo` is therefore 1.5 × the real one (BPM).
//
// THE FORM (132 bpm, 15 bars, about 27 seconds). The bar landmarks are the first theme's, so
// the title card (build-tonight-card.mjs) times the same way off BAR_SEC:
//   1      a drum fill and an organ swell on C7♯9, the band coming in
//   2      the hit on Fm9, and the groove starts
//   3-6    the riff in the tenor over an Fm9 / B♭13 vamp, the horns answering it
//   7-10   the riff with the section in unison, then the turn: D♭maj9 to C7♯9
//   11-12  the shout: stop-time hits, then everyone climbing chromatically to C
//   13-14  Fm9 held under a sax wail, and the button on beat four
//   15     tails
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

export const SONG_NAME = 'tonight_theme_late';
const SONG_ID = `aud_song_${SONG_NAME}`;
const BPM = 132;
const PER_BEAT = 6;
const ROW = PER_BEAT * 4;
const BARS = 15;
const ROWS = BARS * ROW;
export const TEMPO = BPM * PER_BEAT / 4;   // the tracker's tempo: a row is a sixteenth of it
export const BAR_SEC = 60 / BPM * 4;
const MASTER = 0.6;

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const midi = (n) => { const m = /^([A-G][#b]?)(-?\d)$/.exec(n); if (!m || PC[m[1]] == null) throw new Error(`bad note ${n}`); return (+m[2] + 1) * 12 + PC[m[1]]; };

// ── the band ────────────────────────────────────────────────────────────────
const env = (a, d, s, r, curve) => ({ a, d, s, r, ...(curve ? { curve } : {}) });
const lp = (freq, q = 0.8) => ({ type: 'lowpass', freq, q });
const bp = (freq, q = 0.8) => ({ type: 'bandpass', freq, q });
const hp = (freq, q = 0.7) => ({ type: 'highpass', freq, q });
const bend = (id, cents, d) => ({ id, type: 'env', a: 0.001, d, s: 0, r: 0.05, to: [{ param: 'pitch', amount: cents }] });
const vib = (id, rate, cents, fade) => ({ id, type: 'lfo', wave: 'sine', rate, fade, to: [{ param: 'pitch', amount: cents }] });
const bloom = (id, cents, a, d, s) => ({ id, type: 'env', a, d, s, r: 0.15, to: [{ param: 'filter.cutoff', amount: cents }] });

export const INSTRUMENTS = {
  // A tenor sax: a reedy sawtooth through the horn's formants, scooped up into each note,
  // with breath on the attack, a little tube growl and a vibrato that comes in late.
  tenor: { name: 'Late Night: Tenor sax', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', detune: -4, gain: 0.2, adsr: env(0.035, 0.18, 0.82, 0.12),
      formants: [{ freq: 520, q: 3.5, gain: 1 }, { freq: 1180, q: 5, gain: 0.75 }, { freq: 2550, q: 6, gain: 0.35 }],
      drive: 0.3, driveType: 'tube', eq: { low: -4, mid: 2, high: 1 },
      mods: [bend('sc', -70, 0.07), vib('vb', 5.4, 16, 0.35)], echo: { mix: 0.16, delay: 0.21, feedback: 0.28 } },
    { waveform: 'square', detune: 5, gain: 0.045, adsr: env(0.04, 0.2, 0.7, 0.12), filter: lp(1700, 1.2), mods: [vib('vb', 5.1, 14, 0.4)] },
    { waveform: 'sawtooth', noiseMix: 1, noise: 'pink', gain: 0.04, adsr: env(0.02, 0.12, 0.25, 0.08), filter: bp(2300, 1.1), noiseSeed: 7 },
  ] },
  // A fingered electric bass: round and a little growly, the note blooming on the pluck.
  bass: { name: 'Late Night: Electric bass', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', gain: 0.065, adsr: env(0.004, 0.3, 0.55, 0.07), filter: lp(520, 1.1),
      mods: [bloom('bl', 1500, 0.004, 0.12, 0.2)], drive: 0.18, driveType: 'tube' },
    { waveform: 'triangle', gain: 0.1, adsr: env(0.004, 0.4, 0.7, 0.07), sub: { level: 0.3, octave: 1, wave: 'sine' } },
    { waveform: 'sawtooth', noiseMix: 1, gain: 0.02, adsr: env(0.001, 0.02, 0, 0.01, 'exp'), filter: bp(1400, 1), noiseSeed: 13 },
  ] },
  // A Rhodes: a sine tine with an FM bark on the attack, a bell partial over it and the
  // amplifier's tremolo.
  rhodes: { name: 'Late Night: Rhodes', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.24, adsr: env(0.002, 1.6, 0.25, 0.4, 'exp'), fm: { ratio: 1, index: 1.8, indexEnd: 0.15, time: 0.5 },
      tremolo: { rate: 4.6, depth: 0.18 }, chorus: { rate: 0.6, depth: 0.25, mix: 0.3 } },
    { waveform: 'sine', tune: 24, gain: 0.04, adsr: env(0.001, 0.25, 0, 0.1, 'exp') },
  ] },
  // A Hammond on a Leslie: 16', 8', 4' and 2 2/3' drawbars, a key click, and the rotor's swirl.
  organ: { name: 'Late Night: Hammond organ', waveform: 'sine', layers: [
    { waveform: 'sine', tune: -12, gain: 0.12, adsr: env(0.006, 0.05, 1, 0.07), chorus: { rate: 5.8, depth: 0.35, mix: 0.45 } },
    { waveform: 'sine', gain: 0.14, adsr: env(0.006, 0.05, 1, 0.07), tremolo: { rate: 5.8, depth: 0.12 } },
    { waveform: 'sine', tune: 12, gain: 0.09, adsr: env(0.006, 0.05, 1, 0.07), tremolo: { rate: 6.3, depth: 0.15 } },
    { waveform: 'sine', tune: 19, gain: 0.05, adsr: env(0.006, 0.05, 1, 0.07) },
    { waveform: 'sine', noiseMix: 1, gain: 0.05, adsr: env(0.001, 0.006, 0, 0.004), filter: bp(2600, 0.9), noiseSeed: 17 },
  ] },
  // A funk guitar, muted: a short choked chop, all pick and no sustain.
  guitar: { name: 'Late Night: Muted funk guitar', waveform: 'sawtooth', layers: [
    { waveform: 'sawtooth', gain: 0.16, adsr: env(0.001, 0.06, 0, 0.03, 'exp'), filter: bp(1500, 1.6), drive: 0.35 },
    { waveform: 'square', tune: 7, gain: 0.07, adsr: env(0.001, 0.05, 0, 0.02, 'exp'), filter: bp(2100, 1.4) },
    { waveform: 'sawtooth', noiseMix: 1, gain: 0.08, adsr: env(0.001, 0.03, 0, 0.02, 'exp'), filter: bp(3200, 1), noiseSeed: 19 },
  ] },
  kick: { name: 'Late Night: Kick', waveform: 'sine', layers: [
    { waveform: 'sine', gain: 0.55, adsr: env(0.001, 0.38, 0, 0.1, 'exp'), mods: [bend('bt', 1500, 0.05)] },
    { waveform: 'sine', noiseMix: 1, gain: 0.08, adsr: env(0.0005, 0.012, 0, 0.01, 'exp'), filter: bp(2500, 0.8), noiseSeed: 23 },
  ] },
  snare: { name: 'Late Night: Snare', waveform: 'triangle', layers: [
    { waveform: 'triangle', gain: 0.7, adsr: env(0.001, 0.08, 0, 0.04, 'exp'), mods: [bend('tk', 400, 0.02)] },
    { waveform: 'triangle', noiseMix: 1, gain: 1.1, adsr: env(0.001, 0.16, 0, 0.08, 'exp'), filter: bp(2600, 0.7), noiseSeed: 29,
      echo: { mix: 0.12, delay: 0.09, feedback: 0.2 } },
    { waveform: 'triangle', noiseMix: 1, gain: 0.5, adsr: env(0.0005, 0.07, 0, 0.04, 'exp'), filter: hp(7000), noiseSeed: 31 },
  ] },
  hat: { name: 'Late Night: Hi-hat', waveform: 'square', layers: [
    { waveform: 'square', noiseMix: 1, gain: 1.2, adsr: env(0.0005, 0.045, 0, 0.03, 'exp'), filter: hp(6500), width: 0.5, noiseSeed: 37 },
    { waveform: 'square', gain: 0.12, adsr: env(0.0005, 0.03, 0, 0.02, 'exp'), filter: hp(6000), fm: { ratio: 1.47, index: 4, indexEnd: 2, time: 0.05 } },
  ] },
  ohat: { name: 'Late Night: Open hi-hat', waveform: 'square', layers: [
    { waveform: 'square', noiseMix: 1, gain: 0.9, adsr: env(0.001, 0.35, 0, 0.15, 'exp'), filter: hp(6000), width: 0.6, noiseSeed: 41 },
    { waveform: 'square', gain: 0.1, adsr: env(0.001, 0.3, 0, 0.1, 'exp'), filter: hp(5000), fm: { ratio: 1.47, index: 4, indexEnd: 2, time: 0.3 } },
  ] },
};
const OWN = Object.fromEntries(Object.keys(INSTRUMENTS).map((k) => [k, `aud_inst_late_${k}`]));
// borrowed from the KSAB orchestra (build-ksab-theme.mjs): its brass and cymbals
const BORROW = { trumpet: 'aud_inst_orch_trumpet', trombone: 'aud_inst_orch_trombone', crash: 'aud_inst_orch_crash', swell: 'aud_inst_orch_swell' };
const INST = { ...OWN, ...BORROW };

// ── the score ───────────────────────────────────────────────────────────────
// Tokens as in build-ksab-theme.mjs, lengths in rows of a sixth of a beat:
//   NOTE:LEN[@VOL]  r:LEN  -:LEN (hold the note before)  | (a bar line)
class Part {
  constructor(key, inst, pan) { this.key = key; this.inst = inst; this.pan = pan; this.rows = new Array(ROWS).fill(null); }
  note(bar, row, note, len = 1, vol = 0.8, inst = this.inst) {
    const i = (bar - 1) * ROW + row;
    if (i < 0 || i >= ROWS) throw new Error(`${this.key}: bar ${bar} row ${row} is outside the song`);
    if (this.rows[i]) throw new Error(`${this.key}: bar ${bar} row ${row} already has ${this.rows[i].note}`);
    midi(note);
    this.rows[i] = { note, instrument: INST[inst], vol: +(vol * MASTER).toFixed(3), ...(len > 1 ? { len } : {}) };
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
      if (m[1] === '-') this.last.len = (this.last.len || 1) + len;
      else if (m[1] !== 'r') this.note(bar + Math.floor(at / ROW), at % ROW, m[1], len, m[3] != null ? +m[3] : vol);
      at += len;
    }
    if (at % ROW) throw new Error(`${this.key}: "${text}" is ${at} rows, not whole bars`);
    return this;
  }
  // a drum bar: one character a row (24), X loud, x normal, o ghost, . nothing
  hits(bar, pattern, note, scale = 1) {
    const p = pattern.replace(/\s/g, '');
    if (p.length !== ROW) throw new Error(`${this.key}: pattern of ${p.length} rows`);
    const V = { X: 0.95, x: 0.62, o: 0.22 };
    [...p].forEach((c, row) => { if (V[c]) this.note(bar, row, note, 1, V[c] * scale); });
    return this;
  }
  roll(bar, from, to, note, v0, v1, step = 1) {
    for (let r = from; r <= to; r += step) this.note(bar + Math.floor(r / ROW), r % ROW, note, 1, v0 + (v1 - v0) * (to === from ? 1 : (r - from) / (to - from)));
    return this;
  }
}

// Bandstand: sax up front centre-left, horns right, keys left, bass and drums in the middle.
const P = {
  sax: new Part('sax', 'tenor', -0.12),
  tpt1: new Part('tpt1', 'trumpet', 0.3), tpt2: new Part('tpt2', 'trumpet', 0.38), tbn: new Part('tbn', 'trombone', 0.45),
  bass: new Part('bass', 'bass', 0),
  kick: new Part('kick', 'kick', 0), snare: new Part('snare', 'snare', 0.06), hat: new Part('hat', 'hat', 0.22), cym: new Part('cym', 'crash', -0.18),
  rh1: new Part('rh1', 'rhodes', -0.35), rh2: new Part('rh2', 'rhodes', -0.32), rh3: new Part('rh3', 'rhodes', -0.29),
  org1: new Part('org1', 'organ', -0.5), org2: new Part('org2', 'organ', -0.45),
  gtr: new Part('gtr', 'guitar', 0.55), fx: new Part('fx', 'swell', 0),
};

// The chords, as voicings: three Rhodes notes, two organ notes (third and seventh), the
// horn section's three, and the bass's riff.
const CH = {
  Fm9:   { rh: ['Ab3', 'Eb4', 'G4'], org: ['Ab4', 'Eb5'], horn: ['G5', 'Eb5', 'Ab4'], riff: ['F2', 'C3', 'Eb3', 'F3', 'Eb3', 'C3'] },
  Bb13:  { rh: ['Ab3', 'D4', 'G4'], org: ['D5', 'Ab4'], horn: ['G5', 'D5', 'Ab4'], riff: ['Bb1', 'F2', 'Ab2', 'Bb2', 'Ab2', 'F2'] },
  Dbmaj9: { rh: ['F3', 'C4', 'Eb4'], org: ['F4', 'C5'], horn: ['Eb5', 'C5', 'F4'], riff: ['Db2', 'Ab2', 'C3', 'Db3', 'C3', 'Ab2'] },
  C7s9:  { rh: ['E3', 'Bb3', 'Eb4'], org: ['E4', 'Bb4'], horn: ['Eb5', 'Bb4', 'E4'], riff: ['C2', 'G2', 'Bb2', 'C3', 'Bb2', 'G2'] },
};
const PLAN = { 3: 'Fm9', 4: 'Bb13', 5: 'Fm9', 6: 'Bb13', 7: 'Fm9', 8: 'Bb13', 9: 'Dbmaj9', 10: 'C7s9' };

// the bass's riff: root, rest, the root again, up through the chord and back, swung
function riff(bar, ch, v = 0.85) {
  const [a, b, c, d, e, f] = CH[ch].riff;
  P.bass.line(bar, `${a}:4@${v} r:2 ${a}:2@${v * 0.8} ${b}:4@${v * 0.9} ${c}:2@${v * 0.8} ${d}:2@${v} r:2 ${e}:2@${v * 0.75} ${f}:4@${v * 0.85}`);
}
// Rhodes: two pushed chords a bar, on the and of one and the and of three. Room for the hook.
function comp(bar, ch, v = 0.55) {
  CH[ch].rh.forEach((n, i) => P[`rh${i + 1}`].line(bar, `r:4 ${n}:4@${v} r:12 ${n}:2@${v * 0.85} r:2`));
}
// Hammond: the shell held under the bar, kept back
function organ(bar, ch, v = 0.4) { CH[ch].org.forEach((n, i) => P[`org${i + 1}`].note(bar, 0, n, ROW, v)); }
// guitar: one muted chop on the backbeats' upbeats only
function chop(bar, ch, v = 0.5) { const n = CH[ch].rh[2]; for (const r of [11, 23]) P.gtr.note(bar, r, n, 1, v); }
// the kit: kick on one, the and of two, three and the push into four; backbeat with ghosts;
// swung eighths on the hat with the and of four opened
function groove(bar, v = 1, openAt4 = true, fill = false) {
  P.kick.hits(bar, 'X.........x.x.......x...', 'C2', v);
  P.snare.hits(bar, fill ? '...o..X..o.....o........' : '...o..X..o.....o..X..o..', 'D3', v);
  P.hat.hits(bar, 'x...o.x...o.x...o.x.....', 'A5', v);
  if (openAt4) P.hat.note(bar, 22, 'A5', 1, 0.55 * v, 'ohat');
  else P.hat.note(bar, 22, 'A5', 1, 0.3 * v);
}

// Bar 1: a fill on the toms (the snare, tuned down) and an organ swell on C7♯9.
P.snare.roll(1, 12, 23, 'D3', 0.25, 0.85, 2);
P.kick.note(1, 0, 'C2', 1, 0.7).note(1, 18, 'C2', 1, 0.6);
P.org1.note(1, 0, 'E4', ROW, 0.3); P.org2.note(1, 0, 'Bb4', ROW, 0.3);
P.fx.note(1, 4, 'C5', 20, 0.6);
P.bass.line(1, 'r:18 C2:2@0.7 E2:2@0.75 G2:2@0.8');
P.sax.line(1, 'r:12 G4:2@0.6 Bb4:2@0.65 C5:2@0.7 Eb5:2@0.75 E5:4@0.8');

// Bar 2: the hit on Fm9, then the groove.
P.tpt1.line(2, 'G5:3@1 r:21'); P.tpt2.line(2, 'Eb5:3@0.95 r:21'); P.tbn.line(2, 'Ab4:3@0.95 r:21');
P.sax.line(2, 'F5:3@1 r:9 C5:2@0.7 Eb5:2@0.75 F5:2@0.8 Ab5:6@0.85');
P.cym.note(2, 0, 'C5', 1, 1);
P.kick.note(2, 0, 'C2', 1, 1);
P.snare.note(2, 0, 'D3', 1, 0.8).hits(2, '..............o...X..o..', 'D3');
P.hat.hits(2, '....o.x...o.x...o.x.....', 'A5'); P.hat.note(2, 22, 'A5', 1, 0.5, 'ohat');
P.bass.line(2, 'F2:3@1 r:9 F2:2@0.75 C3:2@0.7 Eb3:2@0.75 F3:2@0.8 Eb3:2@0.7 r:2');
organ(2, 'Fm9', 0.35); chop(2, 'Fm9', 0.4);

// Bars 3-10: the hook. It's a two-bar riff short enough to hum: up the minor chord to F with a
// hiccup on the C, then down from A♭ and home. It ends each bar with a beat and a half of
// room, and the horns answer in it ("bap ... bap"), so it's a call and a response.
//   3-4  the riff        5-6  the riff, the second bar reaching up to C
//   7-8  the riff with the whole section in unison, the trombone an octave under: the punch
//   9-10 the turn, D♭maj9 to C7♯9, the riff's shape sequenced up
const RIFF = 'C5:4@0.95 r:2 C5:2@0.8 Eb5:4@0.9 F5:6@1 r:6';
const RIFF_2 = 'Ab5:4@0.95 G5:2@0.85 F5:4@0.9 Eb5:2@0.85 F5:6@0.95 r:6';
const RIFF_2_UP = 'Ab5:4@0.95 Bb5:2@0.9 C6:6@1 Bb5:4@0.9 Ab5:2@0.85 F5:6@0.9';
const TURN = ['F5:4@0.95 r:2 F5:2@0.8 Ab5:4@0.9 C6:6@1 r:6', 'Bb5:4@0.95 Ab5:2@0.88 G5:4@0.9 E5:2@0.85 G5:6@0.95 r:6'];
P.sax.line(3, RIFF).line(4, RIFF_2).line(5, RIFF).line(6, RIFF_2_UP).line(7, RIFF).line(8, RIFF_2).line(9, TURN[0]).line(10, TURN[1]);
// the section's unison on the third time, and with the sax again on the turn
const down = (l) => l.replace(/([A-G][#b]?)(\d)/g, (_, n, o) => `${n}${+o - 1}`);
for (const [bar, l] of [[7, RIFF], [8, RIFF_2], [9, TURN[0]], [10, TURN[1]]]) { P.tpt1.line(bar, l); P.tbn.line(bar, down(l)); }
for (let b = 3; b <= 10; b++) {
  const ch = PLAN[b];
  riff(b, ch, b >= 7 ? 0.9 : 0.82);
  comp(b, ch, b >= 7 ? 0.5 : 0.42);
  organ(b, ch, b >= 7 ? 0.3 : 0.22);
  chop(b, ch, b >= 7 ? 0.5 : 0.4);
  groove(b, b >= 7 ? 1 : 0.88, b % 2 === 0 && b !== 10, b === 10);
}
// The answers: two short stabs in the riff's rest (rows 18 and 21), the same every time, so
// you learn them. In 7-10 the section's playing the riff, so the second trumpet answers alone.
const horns = (bar, row, ch, len, v) => ['tpt1', 'tpt2', 'tbn'].forEach((k, i) => P[k].note(bar, row, CH[ch].horn[i], len, v * (i ? 0.9 : 1)));
for (const b of [3, 4, 5]) { horns(b, 18, PLAN[b], 2, 0.9); horns(b, 21, PLAN[b], 2, 0.8); }
for (const b of [7, 8, 9, 10]) { P.tpt2.note(b, 18, CH[PLAN[b]].horn[1], 2, 0.85).note(b, 21, CH[PLAN[b]].horn[1], 2, 0.75); }
P.cym.note(7, 0, 'C5', 1, 0.8).note(9, 0, 'C5', 1, 0.6);
P.snare.roll(10, 18, 23, 'D3', 0.4, 0.9);

// Bars 11-12: the shout. Stop-time on Fm9 (one, the and of two, and four), then every line
// climbing chromatically from A♭ to C.
const HITS = 'X:3 r:5 X:2 r:2 X:3 r:3 Y:6';
const hitLine = (n, m) => HITS.replace(/X/g, n).replace(/Y/g, m);
P.sax.line(11, hitLine('Ab5', 'G5'));
P.tpt1.line(11, hitLine('Ab5', 'G5')); P.tpt2.line(11, hitLine('Eb5', 'Db5')); P.tbn.line(11, hitLine('C5', 'Bb4'));
P.bass.line(11, hitLine('F2', 'E2'));
P.rh1.line(11, hitLine('Ab3', 'G3')); P.rh2.line(11, hitLine('Eb4', 'Db4')); P.rh3.line(11, hitLine('G4', 'F4'));
P.kick.hits(11, 'X.......X...X...........', 'C2'); P.snare.hits(11, 'X.......X...X.....X.....', 'D3');
P.cym.note(11, 0, 'C5', 1, 0.95).note(11, 18, 'C5', 1, 0.7);
const climb = (part, a, b, c, d, e, v = 0.9) => part.line(12, `${a}:4@${v} ${b}:4@${v + 0.02} ${c}:4@${v + 0.04} ${d}:4@${v + 0.06} ${e}:8@${v + 0.08}`);
climb(P.sax, 'Ab5', 'A5', 'Bb5', 'B5', 'C6');
climb(P.tpt1, 'Ab5', 'A5', 'Bb5', 'B5', 'C6'); climb(P.tpt2, 'Eb5', 'E5', 'F5', 'F#5', 'G5', 0.85); climb(P.tbn, 'C5', 'C#5', 'D5', 'D#5', 'E5', 0.85);
climb(P.bass, 'Db2', 'D2', 'Eb2', 'E2', 'C2', 0.88);
P.org1.line(12, 'Ab4:4@0.4 A4:4@0.42 Bb4:4@0.44 B4:4@0.46 E4:8@0.5'); P.org2.line(12, 'Eb5:4@0.4 E5:4@0.42 F5:4@0.44 F#5:4@0.46 Bb4:8@0.5');
P.kick.hits(12, 'X...X...X...X...X.......', 'C2', 0.85);
P.snare.roll(12, 0, 23, 'D3', 0.3, 1, 2);
P.fx.note(12, 4, 'C5', 20, 0.8);

// Bars 13-14: Fm9 held under a sax wail, a shake on top, and the button on beat four.
P.sax.line(13, 'C6:36@1 r:6 F5:3@1 r:3');
const hold = (part, n, v = 1) => part.line(13, `${n}:30@${v} r:12 ${n}:3@${v} r:3`);
hold(P.tpt1, 'G5'); hold(P.tpt2, 'Eb5'); hold(P.tbn, 'Ab4');
hold(P.rh1, 'Ab3', 0.7); hold(P.rh2, 'Eb4', 0.7); hold(P.rh3, 'G4', 0.7);
hold(P.org1, 'Ab4', 0.5); hold(P.org2, 'Eb5', 0.5);
P.bass.line(13, 'F2:30@1 r:12 F1:3@1 r:3');
P.cym.note(13, 0, 'C5', 1, 1).note(14, 18, 'C5', 1, 1);
P.kick.note(13, 0, 'C2', 1, 1).note(14, 18, 'C2', 1, 1);
P.snare.note(13, 0, 'D3', 1, 0.9).roll(13, 6, 40, 'D3', 0.15, 0.6, 2);
P.snare.note(14, 18, 'D3', 1, 1);
P.gtr.note(14, 18, 'G4', 1, 0.7);
P.hat.note(13, 0, 'A5', 1, 0.6, 'ohat');

// ── compile ─────────────────────────────────────────────────────────────────
const parts = Object.values(P);
if (parts.length > 16) throw new Error(`${parts.length} parts: a song plays sixteen channels`);
for (const p of parts) p.rows.forEach((s, i) => { if (s && i + (s.len || 1) > ROWS) throw new Error(`${p.key}: ${s.note} at row ${i} runs past the end`); });
const used = [...new Set(parts.flatMap((p) => p.rows.filter(Boolean).map((s) => s.instrument)))].sort();
for (const id of Object.values(BORROW)) if (used.includes(id) && !fs.existsSync(path.join(ROOT, `content/audio_instruments/${id}.json`))) throw new Error(`no instrument ${id}`);

export const song = {
  id: SONG_ID, name: SONG_NAME, category: 'theme', tempo: TEMPO, loop_start: 0, loop_end: 0, priority: 6, enabled: 1,
  instrument_ids: used, channels: parts.map((p) => p.rows), channel_pan: parts.map((p) => p.pan),
};
const own = Object.entries(INSTRUMENTS).map(([key, def]) => ({
  id: OWN[key], name: def.name, category: 'band', waveform: def.waveform, enabled: 1, sample_id: null,
  config: { layers: def.layers.map((l) => ({ waveform: def.waveform, ...l })) },
}));
export const instruments = [
  ...own,
  ...Object.values(BORROW).filter((id) => used.includes(id)).map((id) => JSON.parse(fs.readFileSync(path.join(ROOT, `content/audio_instruments/${id}.json`), 'utf8'))),
];

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = [...own.map((r) => [`content/audio_instruments/${r.id}.json`, r]), [`content/audio_songs/${SONG_ID}.json`, song]];
  let stale = 0;
  for (const [rel, row] of files) {
    const p = path.join(ROOT, rel);
    const want = canonicalJson(row);
    const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (have === want) continue;
    stale++;
    if (CHECK) console.error(`✗ ${rel} is behind scripts/content/build-tonight-theme-2.mjs`);
    else { fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`); }
  }
  if (CHECK && stale) process.exit(1);
  const notes = parts.reduce((n, q) => n + q.rows.filter(Boolean).length, 0);
  console.log(`${CHECK ? '✓ up to date' : '✓ built'}: ${SONG_NAME}, ${parts.length} channels, ${notes} notes, ${BARS} bars at ${BPM} bpm (${(BARS * BAR_SEC).toFixed(1)} s)`);
}
