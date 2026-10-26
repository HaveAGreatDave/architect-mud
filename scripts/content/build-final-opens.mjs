// The finals' opens: the music under the fly-in before the Curtain Call and the Coldwater Cup,
// written here as scores and compiled to tracker songs.
//
//   node scripts/content/build-final-opens.mjs           write the song files
//   node scripts/content/build-final-opens.mjs --check   fail if the files are behind this script
//
// Each plays once, from the final's first line ("Live from…"), which starts the 3-D view's fly-in
// over the city onto the park (diamond/camera.js approachShot, gl/approach.js). The fly-in is twelve
// seconds, so each open is cut to it: a hit at 1.5 s as the venue's name goes up, the network's call
// as the camera comes in over the city, a climb as it comes down, and the last chord at 12 s as it
// lands (on the Coliseum's main gate, on the Gardens' ice). The package's pages that follow each go
// up on a sting in the open's key (tv.js packageSting), the key the venue names (venue.finalOpen).
//
// They're the network's, so they borrow from its two themes and play on their instruments, adding
// none: the Curtain Call's is the orchestra of Deadball's theme (build-ksab-theme.mjs), the Cup's
// the FM band of the CPhL's (build-cphl-theme.mjs). Both take the call (5 5 5 1) and the ending
// (♭VI, ♭VII, I), so a final sounds like the night's theme turned up.
//
// THE CURTAIN CALL (120 bpm, 8 bars, 16 s; a bar is 2 s). D major, lifting to E as the theme does:
//   1      the timpani rolling up from nothing under a cymbal swell, the cellos on D; the brass hit
//          on beat 4 (1.5 s), as the name goes up
//   2-3    the call in the trumpets, broad, the horns answering with the dirge's opening
//   4-5    ♭VI, ♭VII, I in D, the snare rolling in
//   6      B, the dominant of E, everything climbing, the cymbal rising into the landing
//   7      E at 12 s, tutti; the button on beat 4
//   8      the tails
// THE COLDWATER CUP (160 bpm, 10 bars, 15 s; a bar is 1.5 s). A♭, the goal horn's own key:
//   1      the toms and a snare roll under a cymbal swell, the power chord rising on F
//   2      the hit at 1.5 s, with the goal horn, as the name goes up
//   3-4    the call in A♭ over the gallop
//   5-6    the theme's tune in F minor, the bells over it
//   7-8    ♭VI and ♭VII in kicks, the timpani rolling into the landing
//   9      A♭ and the horn at 12 s; the band stops, the horn alone, the button
//   10     the tails
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import { instruments as orchestra } from './build-ksab-theme.mjs';
import { band } from './build-cphl-theme.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');
const ROW = 16;   // rows a bar: a row is a 16th
const KNOWN = new Set([...orchestra, ...band].map((r) => r.id));

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const midi = (n) => { const m = /^([A-G][#b]?)(-?\d)$/.exec(n); if (!m || PC[m[1]] == null) throw new Error(`bad note ${n}`); return (+m[2] + 1) * 12 + PC[m[1]]; };

// A part is one channel: one note at a time. `line(bar, text)` reads tokens from a bar:
//   NOTE:LEN[@VOL]   a note `len` rows long      r:LEN   a rest
//   -:LEN            the note before held on     |       a bar line, which has to fall on one
function score(name, tempo, bars, master) {
  const ROWS = bars * ROW, parts = [];
  class Part {
    constructor(key, inst, pan, fader = 1) { this.key = key; this.inst = inst; this.pan = pan; this.fader = fader; this.rows = new Array(ROWS).fill(null); parts.push(this); }
    note(bar, row, note, len = 1, vol = 0.8, inst = this.inst) {
      const i = (bar - 1) * ROW + row;
      if (i < 0 || i >= ROWS) throw new Error(`${name} ${this.key}: bar ${bar} row ${row} is outside the song`);
      if (this.rows[i]) throw new Error(`${name} ${this.key}: bar ${bar} row ${row} already has ${this.rows[i].note}`);
      midi(note);
      this.rows[i] = { note, instrument: `aud_inst_${inst}`, vol: +(Math.min(1, vol * this.fader) * master).toFixed(3), ...(len > 1 ? { len } : {}) };
      this.last = this.rows[i];
      return this;
    }
    line(bar, text, vol = 0.8, inst = this.inst) {
      let at = 0;
      for (const tok of text.trim().split(/\s+/)) {
        if (tok === '|') { if (at % ROW) throw new Error(`${name} ${this.key}: bar line at row ${at} in "${text}"`); continue; }
        const m = /^([A-G][#b]?-?\d|r|-):(\d+)(?:@([\d.]+))?$/.exec(tok);
        if (!m) throw new Error(`${name} ${this.key}: bad token ${tok}`);
        const len = +m[2];
        if (m[1] === '-') { if (!this.last) throw new Error(`${name} ${this.key}: tie with nothing to hold`); this.last.len = (this.last.len || 1) + len; }
        else if (m[1] !== 'r') this.note(bar + Math.floor(at / ROW), at % ROW, m[1], len, m[3] != null ? +m[3] : vol, inst);
        at += len;
      }
      return this;
    }
    // a drum pattern for one bar: X loud, x normal, o soft, . nothing
    hits(bar, pattern, note, scale = 1) {
      const V = { X: 0.9, x: 0.62, o: 0.36 };
      const cells = [...pattern.replace(/\s/g, '')];
      if (cells.length !== ROW) throw new Error(`${name} ${this.key}: bar ${bar} pattern isn't ${ROW} rows`);
      cells.forEach((c, row) => { if (V[c]) this.note(bar, row, note, 1, V[c] * scale); });
      return this;
    }
    // a roll: every row from..to on one note, the level going from v0 to v1
    roll(bar, from, to, note, v0, v1, inst = this.inst) {
      for (let r = from; r <= to; r++) this.note(bar + Math.floor(r / ROW), r % ROW, note, 1, v0 + (v1 - v0) * (to === from ? 1 : (r - from) / (to - from)), inst);
      return this;
    }
  }
  const compile = () => {
    if (parts.length > 16) throw new Error(`${name}: ${parts.length} parts; a song plays sixteen channels`);
    const used = [...new Set(parts.flatMap((p) => p.rows.filter(Boolean).map((s) => s.instrument)))].sort();
    for (const id of used) if (!KNOWN.has(id)) throw new Error(`${name}: no instrument ${id}`);
    for (const p of parts) p.rows.forEach((s, i) => { if (s && i + (s.len || 1) > ROWS) throw new Error(`${name} ${p.key}: ${s.note} at row ${i} runs past the end`); });
    return {
      id: `aud_song_${name}`, name, category: 'theme', tempo, loop_start: 0, loop_end: 0, priority: 6, enabled: 1,
      instrument_ids: used, channels: parts.map((p) => p.rows), channel_pan: parts.map((p) => p.pan),
    };
  };
  return { Part, compile, secs: (bars * ROW * 60) / tempo / 4 };
}

// ── the Curtain Call ────────────────────────────────────────────────────────
// Orchestral seating, as the theme has it.
export const CC_NAME = 'ksab7_curtaincall_open', CC_TEMPO = 120, CC_BARS = 8;
function curtainCall() {
  const { Part, compile } = score(CC_NAME, CC_TEMPO, CC_BARS, 0.85);
  const tpt1 = new Part('tpt1', 'orch_trumpet', 0.12), tpt2 = new Part('tpt2', 'orch_trumpet', 0.22);
  const hrn1 = new Part('hrn1', 'orch_horn', -0.28), hrn2 = new Part('hrn2', 'orch_horn', -0.36);
  const tbn = new Part('tbn', 'orch_trombone', 0.32), tuba = new Part('tuba', 'orch_tuba', 0.42);
  const vln = new Part('vln', 'orch_strings', -0.45), pad = new Part('pad', 'orch_pad', -0.12), vc = new Part('vc', 'orch_cellos', 0.35);
  const timp = new Part('timp', 'orch_timpani', -0.1), snare = new Part('snare', 'orch_snare', 0.05), bd = new Part('bd', 'orch_bassdrum', -0.05);
  const cym = new Part('cym', 'orch_crash', 0), glock = new Part('glock', 'orch_glock', -0.3);

  // Bar 1: the roll from nothing under the swell, the cellos and the pad on D; the hit on beat 4.
  timp.roll(1, 0, 11, 'D2', 0.08, 0.62);
  cym.note(1, 0, 'C5', 12, 0.55, 'orch_swell');
  vc.line(1, 'D2:12@0.5');
  pad.line(1, 'A3:12@0.35');
  for (const [p, n] of [[tpt1, 'D5'], [tpt2, 'A4'], [hrn1, 'F#4'], [hrn2, 'D4'], [tbn, 'A3'], [tuba, 'D2'], [vln, 'F#5']]) p.note(1, 12, n, 4, 0.95);
  timp.note(1, 12, 'D2', 1, 1); bd.note(1, 12, 'C2', 1, 0.9); cym.note(1, 12, 'C5', 1, 1);

  // Bars 2-3: the call, broad, a beat a note (A A A D), the horns answering with the dirge's
  // opening (A D F♯ E | D), the strings in 3-3-2 on D.
  tpt1.line(2, 'A4:4@0.9 A4:4@0.88 A4:4@0.9 D5:4@1 | -:12 r:4');
  tpt2.line(2, 'F#4:4@0.8 F#4:4@0.78 F#4:4@0.8 A4:4@0.9 | -:12 r:4');
  hrn1.line(2, 'r:16 | A4:3@0.82 D5:3@0.85 F#5:2@0.88 E5:4@0.85 D5:4@0.85');
  hrn2.line(2, 'D4:16@0.55 | F#4:8@0.6 G4:4@0.6 F#4:4@0.6');
  tbn.line(2, 'D3:16@0.6 | D3:8@0.6 A3:8@0.6');
  tuba.line(2, 'D2:16@0.65 | D2:16@0.62');
  for (const b of [2, 3]) {
    vln.line(b, 'D5:3@0.6 D5:3@0.5 D5:2@0.55 D5:3@0.6 D5:3@0.5 D5:2@0.55');
    vc.line(b, 'D2:3@0.7 D2:3@0.55 A2:2@0.6 D2:3@0.7 D2:3@0.55 A2:2@0.6');
    bd.hits(b, 'X.......x.......', 'C2', 0.8);
  }
  timp.note(2, 0, 'D2', 1, 0.8).note(3, 0, 'A2', 1, 0.7);
  cym.note(2, 0, 'C5', 1, 0.75);
  glock.line(2, 'A6:4@0.45 A6:4@0.42 A6:4@0.45 D7:4@0.55');

  // Bars 4-5: ♭VI, ♭VII, I in D, two beats each and the I held, the snare rolling in.
  const chord = (bar, row, len, notes, v) => [tpt1, tpt2, hrn1, hrn2, tbn, tuba].forEach((p, i) => p.note(bar, row, notes[i], len, v));
  chord(4, 0, 8, ['D5', 'Bb4', 'F4', 'D4', 'Bb2', 'Bb1'], 0.88);
  chord(4, 8, 8, ['E5', 'C5', 'G4', 'E4', 'C3', 'C2'], 0.9);
  chord(5, 0, 16, ['F#5', 'D5', 'A4', 'F#4', 'D3', 'D2'], 0.95);
  vln.line(4, 'F5:8@0.7 G5:8@0.72 | A5:16@0.78');
  vc.line(4, 'Bb1:8@0.8 C2:8@0.82 | D2:16@0.85');
  pad.line(4, 'D4:8@0.45 E4:8@0.45 | F#4:16@0.5');
  timp.note(4, 0, 'Bb1', 1, 0.85).note(4, 8, 'C2', 1, 0.85).note(5, 0, 'D2', 1, 0.95);
  bd.note(4, 0, 'C2', 1, 0.85).note(4, 8, 'C2', 1, 0.85).note(5, 0, 'C2', 1, 0.95);
  cym.note(4, 0, 'C5', 1, 0.7).note(5, 0, 'C5', 1, 0.9);
  snare.roll(5, 4, 15, 'D4', 0.25, 0.75);
  glock.line(5, 'D7:4@0.5 F#6:4@0.45 A6:4@0.48 D7:4@0.55');

  // Bar 6: B, the dominant of E, everyone climbing to it, the cymbal rising into the landing.
  tpt1.line(6, 'B4:4@0.85 D#5:4@0.88 F#5:4@0.92 A5:4@0.95');
  tpt2.line(6, 'F#4:8@0.8 B4:8@0.85');
  hrn1.line(6, 'D#4:8@0.8 F#4:8@0.84'); hrn2.line(6, 'B3:16@0.75');
  tbn.line(6, 'F#3:16@0.8'); tuba.line(6, 'B1:16@0.85');
  vln.line(6, 'B4:2@0.6 C#5:2@0.62 D#5:2@0.65 E5:2@0.68 F#5:2@0.72 G#5:2@0.76 A5:2@0.8 A#5:2@0.85');
  vc.line(6, 'B1:16@0.85'); pad.line(6, 'D#4:16@0.55');
  timp.roll(6, 0, 15, 'B1', 0.3, 0.9);
  snare.roll(6, 0, 15, 'D4', 0.5, 0.95);
  cym.note(6, 4, 'C5', 12, 0.8, 'orch_swell');

  // Bar 7 (12 s): E, everything, three beats, a breath, the button on beat 4.
  for (const [p, n, v] of [[tpt1, 'B5', 1], [tpt2, 'G#5', 0.95], [hrn1, 'E5', 0.95], [hrn2, 'B4', 0.9], [tbn, 'E3', 0.9], [tuba, 'E2', 0.95], [vln, 'E6', 0.9], [vc, 'E2', 0.95], [pad, 'G#4', 0.6]]) {
    p.line(7, `${n}:10@${v} r:2 ${n}:4@${Math.min(1, v + 0.05)}`);
  }
  timp.note(7, 0, 'E2', 1, 1).roll(7, 2, 9, 'E2', 0.3, 0.6).note(7, 12, 'E2', 1, 1);
  bd.note(7, 0, 'C2', 1, 1).note(7, 12, 'C2', 1, 1);
  cym.note(7, 0, 'C5', 1, 1).note(7, 12, 'C5', 1, 1);
  snare.note(7, 0, 'D4', 1, 0.8).note(7, 12, 'D4', 1, 1);
  glock.line(7, 'E7:10@0.6 r:2 E7:4@0.65');
  return compile();
}

// ── the Coldwater Cup ───────────────────────────────────────────────────────
// The band's stage, as the CPhL's theme has it. The kick is played on D3 and the snare on E3, as
// there (their pitch drops are in Hz).
export const CUP_NAME = 'ksab7_cup_open', CUP_TEMPO = 160, CUP_BARS = 10;
function coldwaterCup() {
  const { Part, compile } = score(CUP_NAME, CUP_TEMPO, CUP_BARS, 1);
  const KICK = 'D3', SNARE = 'E3', HAT = 'C6', CYM = 'C5';
  const lead = new Part('lead', 'fm_lead', 0.06), harm = new Part('harm', 'fm_brass', -0.2), sect = new Part('sect', 'fm_brass', 0.24);
  const gtr = new Part('gtr', 'fm_power', -0.38), bass = new Part('bass', 'fm_bass', 0), org = new Part('org', 'fm_organ', 0.4);
  const bell = new Part('bell', 'fm_bell', -0.32), horn = new Part('horn', 'fm_horn', 0, 0.75), timp = new Part('timp', 'orch_timpani', -0.14, 0.85);
  const kick = new Part('kick', 'fm_kick', 0, 0.9), snare = new Part('snare', 'fm_snare', 0.04), hat = new Part('hat', 'fm_hat', 0.3, 1.3);
  const cym = new Part('cym', 'orch_crash', -0.06, 0.85), tom = new Part('tom', 'fm_tom', -0.18);

  // Bar 1: the toms and a snare roll under the swell, the power chord rising on F.
  tom.line(1, 'r:8 Ab3:1@0.4 Ab3:1@0.45 F3:1@0.5 F3:1@0.56 Db3:1@0.62 Db3:1@0.7 Db3:1@0.78 Db3:1@0.86');
  snare.roll(1, 4, 15, SNARE, 0.12, 0.7);
  cym.note(1, 0, CYM, 16, 0.6, 'orch_swell');
  gtr.line(1, 'F3:16@0.45'); bass.line(1, 'F2:16@0.5');

  // Bar 2 (1.5 s): the hit and the horn, as the name goes up; the band under it, D♭ to E♭.
  kick.note(2, 0, KICK, 1, 1); cym.note(2, 0, CYM, 1, 1); timp.note(2, 0, 'Ab2', 1, 0.9);
  lead.note(2, 0, 'C5', 3, 1); harm.note(2, 0, 'Ab4', 3, 0.95); sect.note(2, 0, 'Eb4', 3, 0.95);
  horn.note(2, 0, 'Ab3', 12, 1);
  bass.line(2, 'Ab2:4@1 Db2:4@0.8 Db2:4@0.8 Eb2:4@0.85');
  gtr.line(2, 'Ab3:4@1 Db3:4@0.75 Db3:4@0.75 Eb3:4@0.8');
  kick.hits(2, '........x...x.x.', KICK);
  snare.roll(2, 12, 15, SNARE, 0.4, 0.9);

  // Bars 3-4: the call in A♭ (E♭ E♭ E♭ A♭), the gallop under it.
  lead.line(3, 'Eb5:3@0.9 Eb5:3@0.88 Eb5:2@0.9 Ab5:8@1 | -:8 G5:4@0.9 Bb5:4@0.95');
  harm.line(3, 'C5:3@0.82 C5:3@0.8 C5:2@0.82 Eb5:8@0.9 | -:8 Eb5:4@0.8 G5:4@0.85');
  sect.line(3, 'Ab4:16@0.55 | Eb4:16@0.55');
  bell.line(3, 'Eb6:3@0.5 Eb6:3@0.48 Eb6:2@0.5 Ab6:8@0.6 | -:16');
  const GALLOP = [[0, 2, 0, 1], [2, 1, 0, 0.7], [3, 1, 0, 0.74], [4, 2, 12, 0.9], [6, 2, 0, 0.8], [8, 2, 0, 0.95], [10, 1, 0, 0.7], [11, 1, 0, 0.74], [12, 2, 12, 0.9], [14, 2, 7, 0.86]];
  const gallop = (bar, root, level) => {
    const lo = midi(`${root}2`), names = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const n = (m) => `${names[m % 12]}${Math.floor(m / 12) - 1}`;
    for (const [row, len, up, v] of GALLOP) { bass.note(bar, row, n(lo + up), len, level * v); gtr.note(bar, row, `${root}3`, len, level * (len > 1 ? 0.85 : 0.6)); }
  };
  gallop(3, 'Ab', 0.85); gallop(4, 'Eb', 0.88);
  for (const b of [3, 4]) { kick.hits(b, 'X.....x.X.x.....', KICK); hat.hits(b, 'x.o.x.o.x.o.x.o.', HAT); snare.hits(b, '....X.......X...', SNARE); }
  cym.note(3, 0, CYM, 1, 0.8);

  // Bars 5-6: the theme's tune in F minor, the bells running over it.
  lead.line(5, 'C5:4@0.92 F5:4@0.98 Eb5:3@0.9 Db5:3@0.88 C5:2@0.9 | Ab5:6@1 F5:2@0.9 Eb5:4@0.9 Db5:4@0.9');
  harm.line(5, 'Ab4:16@0.55 | F4:16@0.55');
  org.line(5, 'r:2 F5:2@0.5 r:2 F5:2@0.5 r:2 F5:2@0.5 r:2 F5:2@0.5 | r:2 Db5:2@0.5 r:2 Db5:2@0.5 r:2 Db5:2@0.5 r:2 Db5:2@0.5');
  gallop(5, 'F', 0.9); gallop(6, 'Db', 0.9);
  for (const b of [5, 6]) {
    for (let i = 0; i < ROW; i++) bell.note(b, i, [['F6', 'Ab6', 'C7'], ['Db6', 'F6', 'Ab6']][b - 5][i % 3], 1, i % 4 === 0 ? 0.55 : 0.38);
    kick.hits(b, 'X..x..x.X..x..x.', KICK); hat.hits(b, 'xoxoxoxoxoxoxoxo', HAT, 0.85); snare.hits(b, '....X.......X..o', SNARE);
  }
  cym.note(5, 0, CYM, 1, 0.9);

  // Bars 7-8: ♭VI and ♭VII in kicks (E and G♭), the timpani rolling into the landing.
  const kicks = (part, bar, a, v) => part.line(bar, `${a}:2@${v} r:1 ${a}:2@${v} r:1 ${a}:2@${v + 0.04} ${a}:2@${v} r:1 ${a}:2@${v} r:1 ${a}:2@${v + 0.06}`);
  for (const [bar, notes] of [[7, ['G#5', 'E5', 'B4', 'E3', 'E2']], [8, ['Bb5', 'Gb5', 'Db5', 'Gb3', 'Gb2']]]) {
    [lead, harm, sect, gtr, bass].forEach((p, i) => kicks(p, bar, notes[i], 0.86));
    kick.hits(bar, 'X..X..X.X..X..X.', KICK);
    cym.note(bar, 0, CYM, 1, 0.85);
  }
  snare.hits(7, 'X..x..X.X..x..X.', SNARE).roll(8, 0, 15, SNARE, 0.4, 1);
  timp.roll(8, 0, 15, 'Eb2', 0.25, 0.85);
  org.line(8, 'Bb5:2@0.6 C6:2@0.65 Db6:2@0.7 D6:2@0.75 Eb6:2@0.8 F6:2@0.85 G6:2@0.9 Ab6:2@0.95');

  // Bar 9 (12 s): A♭ and the horn. The band holds it, stops, leaves the horn alone, then the button.
  for (const [p, n, v] of [[lead, 'C6', 0.8], [harm, 'Ab5', 0.78], [sect, 'Eb5', 0.78], [gtr, 'Ab3', 0.8], [bass, 'Ab2', 0.85], [org, 'Eb5', 0.55]]) {
    p.line(9, `${n}:10@${v} r:2 ${n}:2@${+(v + 0.1).toFixed(2)} r:2`);
  }
  horn.note(9, 0, 'Ab3', 14, 1);
  bell.line(9, 'Ab6:12@0.7 Ab6:4@0.75');
  timp.note(9, 0, 'Ab2', 1, 0.75).note(9, 12, 'Ab2', 1, 0.9);
  kick.note(9, 0, KICK, 1, 0.8).note(9, 12, KICK, 1, 0.95);
  snare.note(9, 0, SNARE, 1, 0.7).note(9, 12, SNARE, 1, 1);
  cym.note(9, 0, CYM, 1, 0.85).note(9, 12, CYM, 1, 1);
  return compile();
}

export const songs = [curtainCall(), coldwaterCup()];

// ── write ───────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let stale = 0;
  for (const song of songs) {
    const rel = `content/audio_songs/${song.id}.json`, p = path.join(ROOT, rel);
    const want = canonicalJson(song), have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (have === want) continue;
    stale++;
    if (CHECK) console.error(`✗ ${rel} is behind scripts/content/build-final-opens.mjs`);
    else { fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`); }
  }
  if (CHECK && stale) process.exit(1);
  for (const s of songs) {
    const rows = s.channels[0].length, notes = s.channels.reduce((n, c) => n + c.filter(Boolean).length, 0);
    console.log(`${CHECK ? '✓ up to date' : '✓ built'}: ${s.name}, ${s.channels.length} channels, ${notes} notes, ${rows / ROW} bars at ${s.tempo} bpm (${(rows * 60 / s.tempo / 4).toFixed(1)} s)`);
  }
}
