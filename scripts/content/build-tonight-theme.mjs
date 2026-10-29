// The Tonight Show's theme: a swing big-band open, written here as a score and compiled to a
// tracker song.
//
//   node scripts/content/build-tonight-theme.mjs           write the song file
//   node scripts/content/build-tonight-theme.mjs --check   fail if the file is behind this script
//   node scripts/audio/song-render.mjs --module scripts/content/build-tonight-theme.mjs --wav x.wav
//
// It plays under the title card, once (`@theme tonight_theme` in data/scripts/Tonight_Show.bsm),
// and the card holds for it. The card's animation is timed to this score's bars: BAR_SEC is
// exported and the card's delays in Tonight_Show.bsm are written in it, so if TEMPO changes,
// re-time the card.
//
// THE TUNE. A late-night band in B♭, swung: every pair of eighths is a dotted eighth and a
// sixteenth (rows 0 and 3 of a beat), which is a hard swing but reads as one on a tracker grid.
// The hook is a rising sixth and a fall back, F B♭ D | C B♭ G, the shape of "to-NIGHT, to-NIGHT".
//
// THE FORM (152 bpm, 15 bars, about 24 seconds):
//   1      a snare roll and a cymbal swell, the band tuning up to the hit
//   2      the hit, and the shout: the trumpets up the B♭ chord to the top
//   3-6    the hook in the trumpets, the trombones answering, walking bass, ride
//   7-10   the hook again an octave up with the glockenspiel, the whole band
//   11-12  the shout chorus: stabs in 3-3-2, then the climb
//   13-14  the last chord held, a shake on top, and the button on beat four
//   15     silence, for the tails
//
// THE BAND is the KSAB orchestra's instruments (scripts/content/build-ksab-theme.mjs owns
// them); nothing new is written but the song.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

export const SONG_NAME = 'tonight_theme';
const SONG_ID = `aud_song_${SONG_NAME}`;
export const TEMPO = 152;
const ROW = 16;
const BARS = 15;
const ROWS = BARS * ROW;
export const BAR_SEC = 60 / TEMPO * 4;
const MASTER = 0.82;

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const midi = (n) => { const m = /^([A-G][#b]?)(-?\d)$/.exec(n); if (!m || PC[m[1]] == null) throw new Error(`bad note ${n}`); return (+m[2] + 1) * 12 + PC[m[1]]; };
const INST_ID = (key) => `aud_inst_orch_${key}`;

// One channel, one note at a time. Tokens, as in build-ksab-theme.mjs:
//   NOTE:LEN[@VOL]  r:LEN  -:LEN (hold the last note)  | (a bar line)
class Part {
  constructor(key, inst, pan) { this.key = key; this.inst = inst; this.pan = pan; this.rows = new Array(ROWS).fill(null); }
  note(bar, row, note, len = 1, vol = 0.8, inst = this.inst) {
    const i = (bar - 1) * ROW + row;
    if (i < 0 || i >= ROWS) throw new Error(`${this.key}: bar ${bar} row ${row} is outside the song`);
    if (this.rows[i]) throw new Error(`${this.key}: bar ${bar} row ${row} already has ${this.rows[i].note}`);
    midi(note);
    this.rows[i] = { note, instrument: INST_ID(inst), vol: +(vol * MASTER).toFixed(3), ...(len > 1 ? { len } : {}) };
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
    return this;
  }
  hits(bar, pattern, note, scale = 1) {
    const V = { X: 0.9, x: 0.6, o: 0.32 };
    [...pattern.replace(/\s/g, '')].forEach((c, row) => { if (V[c]) this.note(bar, row, note, 1, V[c] * scale); });
    return this;
  }
  roll(bar, from, to, note, v0, v1) {
    for (let r = from; r <= to; r++) this.note(bar + Math.floor(r / ROW), r % ROW, note, 1, v0 + (v1 - v0) * (to === from ? 1 : (r - from) / (to - from)));
    return this;
  }
}

// Bandstand seating: trumpets back right, trombones front right, bass and drums centre,
// the reeds' parts (played here by the horns) left.
const P = {
  tpt1: new Part('tpt1', 'trumpet', 0.18), tpt2: new Part('tpt2', 'trumpet', 0.3),
  hrn1: new Part('hrn1', 'horn', -0.3), hrn2: new Part('hrn2', 'horn', -0.4),
  tbn1: new Part('tbn1', 'trombone', 0.35), tbn2: new Part('tbn2', 'trombone', 0.45),
  bass: new Part('bass', 'cellos', 0.05), tuba: new Part('tuba', 'tuba', 0.1),
  ride: new Part('ride', 'snare', -0.2), snare: new Part('snare', 'snare', 0.05),
  bd: new Part('bd', 'bassdrum', 0), cym: new Part('cym', 'crash', -0.1),
  keys: new Part('keys', 'glock', -0.25), pad: new Part('pad', 'pad', -0.05),
};

// Walking bass: four quarters a bar. Doubled by the tuba an octave down when the band's in.
function walk(bar, notes, v = 0.75, tuba = 0) {
  notes.split(' ').forEach((n, i) => {
    P.bass.note(bar, i * 4, n, 3, v * (i % 2 ? 0.85 : 1));
    if (tuba) P.tuba.note(bar, i * 4, n.replace(/\d/, (d) => String(+d - 1)), 3, tuba * (i % 2 ? 0.8 : 1));
  });
}
// The ride: swung, "ding, ding-a ding". A tight closed hit from the snare instrument, high.
function ride(bar, v = 0.35) { P.ride.hits(bar, 'x...x..ox...x..o', 'C6', v); }
// Two and four on the snare, light, with a ghost before four.
function backbeat(bar, v = 0.5, fill = false) { P.snare.hits(bar, fill ? '....x.....o.....' : '....x.....o.x...', 'G3', v); P.bd.note(bar, 0, 'A1', 1, v * 0.9).note(bar, 8, 'A1', 1, v * 0.6); }

// The hook, as the trumpets play it (bars 3-6 / 7-10).
const HOOK = 'F4:3@0.95 Bb4:1@0.85 D5:4@1 C5:3@0.9 Bb4:1@0.8 G4:4@0.92 | F4:6@0.95 G4:2@0.85 Bb4:8@0.95 | Eb5:3@1 D5:1@0.88 C5:4@0.95 Bb4:3@0.9 G4:1@0.8 F4:4@0.9 | G4:4@0.92 A4:4@0.94 C5:8@1';
const up = (s) => s.replace(/([A-G][#b]?)(\d)/g, (_, n, o) => `${n}${+o + 1}`);
const HARM = 'D4:3@0.8 F4:1@0.7 F4:4@0.82 Eb4:3@0.76 D4:1@0.7 Eb4:4@0.78 | D4:6@0.8 Eb4:2@0.72 D4:8@0.8 | G4:3@0.82 F4:1@0.74 Eb4:4@0.8 D4:3@0.76 Eb4:1@0.7 D4:4@0.76 | Eb4:4@0.78 F4:4@0.8 Eb4:8@0.84';

// Bar 1: the roll up to the hit.
P.snare.roll(1, 0, 15, 'G3', 0.15, 0.85);
P.cym.note(1, 2, 'C5', 14, 0.85, 'swell');
P.bass.line(1, 'r:8 F2:4@0.6 A2:4@0.7');
P.tuba.line(1, 'r:8 F1:4@0.6 A1:4@0.7');

// Bar 2: the hit, then the shout up the chord.
P.tpt1.line(2, 'D5:3@1 r:1 F4:2@0.85 Bb4:2@0.88 D5:2@0.9 F5:6@1');
P.tpt2.line(2, 'Bb4:3@0.95 r:1 D4:2@0.8 F4:2@0.82 Bb4:2@0.85 D5:6@0.95');
P.hrn1.line(2, 'F4:3@1 r:5 F4:8@0.8');
P.hrn2.line(2, 'D4:3@1 r:5 Bb3:8@0.78');
P.tbn1.line(2, 'Bb3:3@1 r:5 D4:8@0.78');
P.tbn2.line(2, 'F3:3@1 r:5 Bb3:8@0.76');
P.tuba.line(2, 'Bb1:3@1 r:5 Bb1:8@0.8');
P.bass.line(2, 'Bb2:3@1 r:5 Bb2:8@0.8');
P.bd.note(2, 0, 'A1', 1, 1);
P.cym.note(2, 0, 'C5', 1, 1);
P.snare.note(2, 0, 'G3', 1, 0.9).roll(2, 12, 15, 'G3', 0.4, 0.8);

// Bars 3-6: the hook in the trumpets, the horns under it, the trombones' answers in the gaps.
P.tpt1.line(3, HOOK);
P.hrn1.line(3, HARM.replace(/@([\d.]+)/g, (_, v) => `@${(+v * 0.85).toFixed(2)}`));
P.tbn1.line(4, 'r:12 D4:2@0.7 F4:2@0.75');
P.tbn2.line(4, 'r:12 Bb3:2@0.68 D4:2@0.72');
P.tbn1.line(6, 'r:8 A3:3@0.75 C4:1@0.7 Eb4:4@0.8');
P.tbn2.line(6, 'r:8 F3:3@0.72 A3:1@0.68 C4:4@0.76');
walk(3, 'Bb2 D3 G2 Bb2'); walk(4, 'C3 Eb3 F2 A2'); walk(5, 'Eb2 G2 E2 G2'); walk(6, 'F2 A2 F2 Eb3');
for (const b of [3, 4, 5, 6]) { ride(b); backbeat(b, 0.45, b === 6); }
P.pad.line(3, 'D4:8@0.3 D4:8@0.3 | Eb4:8@0.3 Eb4:8@0.3 | G4:8@0.3 G4:8@0.3 | A4:8@0.32 A4:8@0.34');
P.snare.roll(6, 12, 15, 'G3', 0.35, 0.8);

// Bars 7-10: the hook an octave up, the whole band.
P.tpt1.line(7, up(HOOK));
P.tpt2.line(7, up(HARM));
P.keys.line(7, up(HOOK).replace(/@([\d.]+)/g, (_, v) => `@${(+v * 0.6).toFixed(2)}`));
P.hrn1.line(7, HOOK);
P.hrn2.line(7, HARM);
P.tbn1.line(7, 'D4:8@0.75 Eb4:8@0.75 | D4:8@0.74 C4:8@0.74 | Bb3:8@0.76 Bb3:8@0.76 | C4:8@0.78 Eb4:8@0.82');
P.tbn2.line(7, 'Bb3:8@0.72 G3:8@0.72 | A3:8@0.7 A3:8@0.7 | G3:8@0.72 G3:8@0.72 | A3:8@0.75 C4:8@0.78');
walk(7, 'Bb2 D3 G2 Bb2', 0.85, 0.7); walk(8, 'C3 Eb3 F2 A2', 0.85, 0.7); walk(9, 'Eb2 G2 E2 G2', 0.85, 0.7); walk(10, 'F2 A2 F2 Eb3', 0.85, 0.7);
for (const b of [7, 8, 9, 10]) { ride(b, 0.42); backbeat(b, 0.6, b === 10); }
P.cym.note(7, 0, 'C5', 1, 0.85).note(9, 0, 'C5', 1, 0.6);
P.pad.line(7, 'F4:8@0.4 G4:8@0.4 | G4:8@0.4 A4:8@0.4 | Bb4:8@0.42 Bb4:8@0.42 | C5:8@0.45 Eb5:8@0.48');
P.snare.roll(10, 12, 15, 'G3', 0.45, 0.95);

// Bars 11-12: the shout chorus. Stabs in 3-3-2 on B♭, then the climb on E♭ and F.
const stab = (part, n, v) => part.line(11, `${n}:2@${v} r:4 ${n}:2@${v} r:4 ${n}:2@${v + 0.05} r:2`);
stab(P.tpt1, 'F5', 0.95); stab(P.tpt2, 'D5', 0.9); stab(P.hrn1, 'Bb4', 0.88); stab(P.hrn2, 'F4', 0.85);
stab(P.tbn1, 'D4', 0.9); stab(P.tbn2, 'Bb3', 0.88); stab(P.tuba, 'Bb1', 0.9);
P.bass.line(11, 'Bb2:2@0.95 r:4 Bb2:2@0.9 r:4 Bb2:2@0.95 r:2');
P.snare.line(11, 'G3:1@0.95 r:5 G3:1@0.9 r:5 G3:1@0.95 r:3');
P.bd.note(11, 0, 'A1', 1, 0.95).note(11, 6, 'A1', 1, 0.85).note(11, 12, 'A1', 1, 0.9);
P.cym.note(11, 0, 'C5', 1, 0.9);
P.tpt1.line(12, 'G5:4@0.9 A5:4@0.92 Bb5:4@0.95 C6:4@1');
P.tpt2.line(12, 'Eb5:4@0.86 F5:4@0.88 G5:4@0.9 A5:4@0.95');
P.hrn1.line(12, 'Bb4:4@0.85 C5:4@0.86 D5:4@0.88 Eb5:4@0.9');
P.hrn2.line(12, 'G4:4@0.82 A4:4@0.84 Bb4:4@0.86 C5:4@0.88');
P.tbn1.line(12, 'Eb4:8@0.85 F4:8@0.9');
P.tbn2.line(12, 'G3:8@0.82 A3:8@0.88');
P.tuba.line(12, 'Eb2:8@0.85 F2:8@0.9');
P.bass.line(12, 'Eb2:8@0.9 F2:8@0.95');
P.snare.roll(12, 0, 15, 'G3', 0.4, 1);
P.cym.note(12, 2, 'C5', 14, 1, 'swell');

// Bars 13-14: the last chord, B♭6/9, held with a shake on top; then the button on four.
const last = [['tpt1', 'D6'], ['tpt2', 'Bb5'], ['hrn1', 'G5'], ['hrn2', 'F5'], ['tbn1', 'D4'], ['tbn2', 'Bb3'], ['tuba', 'Bb1'], ['bass', 'Bb2'], ['pad', 'C5']];
for (const [k, n] of last) P[k].line(13, `${n}:24@1 r:4 ${n}:2@1 r:2`);
P.keys.line(13, 'D6:16@0.7 | F6:8@0.7 r:4 Bb6:2@0.85 r:2');
P.bd.note(13, 0, 'A1', 1, 1).note(14, 12, 'A1', 1, 1);
P.cym.note(13, 0, 'C5', 1, 1).note(14, 12, 'C5', 1, 1);
P.snare.note(13, 0, 'G3', 1, 0.9).roll(13, 4, 26, 'G3', 0.25, 0.75).note(14, 12, 'G3', 1, 1);

// ── compile ─────────────────────────────────────────────────────────────────
const parts = Object.values(P);
if (parts.length > 16) throw new Error(`${parts.length} parts: a song plays sixteen channels`);
const used = [...new Set(parts.flatMap((p) => p.rows.filter(Boolean).map((s) => s.instrument)))].sort();
for (const id of used) if (!fs.existsSync(path.join(ROOT, `content/audio_instruments/${id}.json`))) throw new Error(`no instrument ${id}`);
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
export const instruments = used.map((id) => JSON.parse(fs.readFileSync(path.join(ROOT, `content/audio_instruments/${id}.json`), 'utf8')));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rel = `content/audio_songs/${SONG_ID}.json`;
  const p = path.join(ROOT, rel);
  const want = canonicalJson(song);
  const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (have !== want) {
    if (CHECK) { console.error(`✗ ${rel} is behind scripts/content/build-tonight-theme.mjs`); process.exit(1); }
    fs.writeFileSync(p, want, 'utf8');
    console.log(`  wrote ${rel}`);
  }
  const notes = parts.reduce((n, q) => n + q.rows.filter(Boolean).length, 0);
  console.log(`${CHECK ? '✓ up to date' : '✓ built'}: ${SONG_NAME}, ${parts.length} channels, ${notes} notes, ${BARS} bars at ${TEMPO} bpm (${(BARS * BAR_SEC).toFixed(1)} s); a bar is ${BAR_SEC.toFixed(3)} s`);
}
