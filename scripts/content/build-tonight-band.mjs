// The Tonight Show's house band: the short bits it plays during the show, on the theme's own
// instruments (build-tonight-theme-2.mjs) and off its riff, so every one sounds like the same band.
//
//   node scripts/content/build-tonight-band.mjs           write the songs
//   node scripts/content/build-tonight-band.mjs --check   fail if the files are behind this script
//   node scripts/audio/song-lint.mjs --module scripts/content/build-tonight-band.mjs
//
// THE BITS (132 bpm, swung, six rows a beat, F minor like the theme). The talk show names them in its
// pools' `band` (content/media_broadcasts, plugins/broadcast assembleTalkshowGraph):
//   walkon     3 bars, 5.5 s  the riff with the horns answering, then the hit: the host walks out to it
//   sting_a    1 bar,  1.8 s  "bap ... bap" from the horns over a kick and a crash: a joke's button
//   sting_b    1 bar,  1.8 s  the sax's pickup (C, E♭, F) into a section hit and a rimshot
//   walkover   4 bars, 7.3 s  the riff again while he walks from the star to the desk, a hit at the end
//   guest      3 bars, 5.5 s  the turn (D♭maj9 to C7♯9) and home on Fm9: the guest's play-on
//   playoff    3 bars, 5.5 s  the shout's chromatic climb to C, then Fm9 and the button: goodnight
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

const BPM = 132;
const PER_BEAT = 6;
const ROW = PER_BEAT * 4;
const TEMPO = BPM * PER_BEAT / 4;
const MASTER = 0.6;
const INST = {
  tenor: 'aud_inst_late_tenor', bass: 'aud_inst_late_bass', rhodes: 'aud_inst_late_rhodes', organ: 'aud_inst_late_organ',
  guitar: 'aud_inst_late_guitar', kick: 'aud_inst_late_kick', snare: 'aud_inst_late_snare', hat: 'aud_inst_late_hat', ohat: 'aud_inst_late_ohat',
  trumpet: 'aud_inst_orch_trumpet', trombone: 'aud_inst_orch_trombone', crash: 'aud_inst_orch_crash',
};
for (const id of Object.values(INST)) if (!fs.existsSync(path.join(ROOT, `content/audio_instruments/${id}.json`))) throw new Error(`no instrument ${id}`);

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const checkNote = (n) => { const m = /^([A-G][#b]?)(-?\d)$/.exec(n); if (!m || PC[m[1]] == null) throw new Error(`bad note ${n}`); };

// The theme's voicings and riff (build-tonight-theme-2.mjs CH, RIFF)
const CH = {
  Fm9: { rh: ['Ab3', 'Eb4', 'G4'], horn: ['G5', 'Eb5', 'Ab4'], riff: ['F2', 'C3', 'Eb3', 'F3', 'Eb3', 'C3'] },
  Bb13: { rh: ['Ab3', 'D4', 'G4'], horn: ['G5', 'D5', 'Ab4'], riff: ['Bb1', 'F2', 'Ab2', 'Bb2', 'Ab2', 'F2'] },
  Dbmaj9: { rh: ['F3', 'C4', 'Eb4'], horn: ['Eb5', 'C5', 'F4'], riff: ['Db2', 'Ab2', 'C3', 'Db3', 'C3', 'Ab2'] },
  C7s9: { rh: ['E3', 'Bb3', 'Eb4'], horn: ['Eb5', 'Bb4', 'E4'], riff: ['C2', 'G2', 'Bb2', 'C3', 'Bb2', 'G2'] },
};
const RIFF = 'C5:4@0.95 r:2 C5:2@0.8 Eb5:4@0.9 F5:6@1 r:6';
const RIFF_2 = 'Ab5:4@0.95 G5:2@0.85 F5:4@0.9 Eb5:2@0.85 F5:6@0.95 r:6';
const RIFF_2_UP = 'Ab5:4@0.95 Bb5:2@0.9 C6:6@1 Bb5:4@0.9 Ab5:2@0.85 F5:6@0.9';
const TURN = ['F5:4@0.95 r:2 F5:2@0.8 Ab5:4@0.9 C6:6@1 r:6', 'Bb5:4@0.95 Ab5:2@0.88 G5:4@0.9 E5:2@0.85 G5:6@0.95 r:6'];

// One bit: its parts on the theme's channel layout, `bars` long plus a bar for the tails.
function bit(bars) {
  const ROWS = (bars + 1) * ROW;
  class Part {
    constructor(inst, pan) { this.inst = inst; this.pan = pan; this.rows = new Array(ROWS).fill(null); }
    note(bar, row, note, len = 1, vol = 0.8, inst = this.inst) {
      const i = (bar - 1) * ROW + row;
      if (i < 0 || i >= ROWS) throw new Error(`bar ${bar} row ${row} is outside the bit`);
      if (this.rows[i]) throw new Error(`bar ${bar} row ${row} already has ${this.rows[i].note}`);
      checkNote(note);
      this.rows[i] = { note, instrument: INST[inst], vol: +(vol * MASTER).toFixed(3), ...(len > 1 ? { len } : {}) };
      this.last = this.rows[i];
      return this;
    }
    line(bar, text, vol = 0.8) {
      let at = 0;
      for (const tok of text.trim().split(/\s+/)) {
        const m = /^([A-G][#b]?-?\d|r|-):(\d+)(?:@([\d.]+))?$/.exec(tok);
        if (!m) throw new Error(`bad token ${tok}`);
        if (m[1] === '-') this.last.len = (this.last.len || 1) + +m[2];
        else if (m[1] !== 'r') this.note(bar + Math.floor(at / ROW), at % ROW, m[1], +m[2], m[3] != null ? +m[3] : vol);
        at += +m[2];
      }
      return this;
    }
    hits(bar, pattern, note, scale = 1) {
      const p = pattern.replace(/\s/g, ''), V = { X: 0.95, x: 0.62, o: 0.22 };
      if (p.length !== ROW) throw new Error(`pattern of ${p.length} rows`);
      [...p].forEach((c, row) => { if (V[c]) this.note(bar, row, note, 1, V[c] * scale); });
      return this;
    }
    roll(bar, from, to, note, v0, v1, step = 1) {
      for (let r = from; r <= to; r += step) this.note(bar + Math.floor(r / ROW), r % ROW, note, 1, v0 + (v1 - v0) * (to === from ? 1 : (r - from) / (to - from)));
      return this;
    }
  }
  const P = {
    sax: new Part('tenor', -0.12), tpt1: new Part('trumpet', 0.3), tpt2: new Part('trumpet', 0.38), tbn: new Part('trombone', 0.45),
    bass: new Part('bass', 0), kick: new Part('kick', 0), snare: new Part('snare', 0.06), hat: new Part('hat', 0.22), cym: new Part('crash', -0.18),
    rh1: new Part('rhodes', -0.35), rh2: new Part('rhodes', -0.32), rh3: new Part('rhodes', -0.29), org1: new Part('organ', -0.5), org2: new Part('organ', -0.45),
    gtr: new Part('guitar', 0.55),
  };
  const riff = (bar, ch, v = 0.85) => { const [a, b, c, d, e, f] = CH[ch].riff; P.bass.line(bar, `${a}:4@${v} r:2 ${a}:2@${v * 0.8} ${b}:4@${v * 0.9} ${c}:2@${v * 0.8} ${d}:2@${v} r:2 ${e}:2@${v * 0.75} ${f}:4@${v * 0.85}`); };
  const comp = (bar, ch, v = 0.5) => CH[ch].rh.forEach((n, i) => P[`rh${i + 1}`].line(bar, `r:4 ${n}:4@${v} r:12 ${n}:2@${v * 0.85} r:2`));
  const chop = (bar, ch, v = 0.45) => { for (const r of [11, 23]) P.gtr.note(bar, r, CH[ch].rh[2], 1, v); };
  const groove = (bar, v = 1, fill = false) => {
    P.kick.hits(bar, 'X.........x.x.......x...', 'C2', v);
    P.snare.hits(bar, fill ? '...o..X..o.....o........' : '...o..X..o.....o..X..o..', 'D3', v);
    P.hat.hits(bar, 'x...o.x...o.x...o.x.....', 'A5', v);
    P.hat.note(bar, 22, 'A5', 1, 0.5 * v, 'ohat');
  };
  const horns = (bar, row, ch, len, v) => ['tpt1', 'tpt2', 'tbn'].forEach((k, i) => P[k].note(bar, row, CH[ch].horn[i], len, v * (i ? 0.9 : 1)));
  // the whole band on one chord at `row`, held `len`, with the kick, snare and crash on it
  const hit = (bar, row, ch, len, v = 1) => {
    horns(bar, row, ch, len, v);
    CH[ch].rh.forEach((n, i) => P[`rh${i + 1}`].note(bar, row, n, len, 0.7 * v));
    P.bass.note(bar, row, CH[ch].riff[0], len, v);
    P.kick.note(bar, row, 'C2', 1, v); P.snare.note(bar, row, 'D3', 1, 0.9 * v); P.cym.note(bar, row, 'C5', 1, v);
  };
  return { P, riff, comp, chop, groove, horns, hit, done: (name) => song(name, P, ROWS) };
}

function song(name, P, ROWS) {
  const parts = Object.values(P).filter((p) => p.rows.some(Boolean));
  if (parts.length > 16) throw new Error(`${name}: ${parts.length} parts`);
  for (const p of parts) p.rows.forEach((s, i) => { if (s && i + (s.len || 1) > ROWS) throw new Error(`${name}: ${s.note} at row ${i} runs past the end`); });
  return {
    id: `aud_song_tonight_band_${name}`, name: `tonight_band_${name}`, category: 'theme', tempo: TEMPO, loop_start: 0, loop_end: 0, priority: 6, enabled: 1,
    instrument_ids: [...new Set(parts.flatMap((p) => p.rows.filter(Boolean).map((s) => s.instrument)))].sort(),
    channels: parts.map((p) => p.rows), channel_pan: parts.map((p) => p.pan),
  };
}

export const songs = [];

// walkon: the riff twice with the horns answering, a pickup fill, then the hit on Fm9
{
  const b = bit(3);
  b.P.sax.line(1, RIFF).line(2, RIFF_2);
  b.riff(1, 'Fm9'); b.riff(2, 'Bb13');
  b.comp(1, 'Fm9', 0.45); b.comp(2, 'Bb13', 0.45);
  b.chop(1, 'Fm9'); b.chop(2, 'Bb13');
  b.groove(1, 0.95); b.groove(2, 0.95, true);
  b.horns(1, 18, 'Fm9', 2, 0.9); b.horns(1, 21, 'Fm9', 2, 0.8);
  b.horns(2, 18, 'Bb13', 2, 0.9);
  b.P.snare.roll(2, 19, 23, 'D3', 0.4, 0.85);
  b.P.cym.note(1, 0, 'C5', 1, 0.85);
  b.hit(3, 0, 'Fm9', 9);
  b.P.sax.line(3, 'F5:9@1');
  songs.push(b.done('walkon'));
}
// sting_a: "bap ... bap", the answer the horns give the riff, on a kick, then the crash
{
  const b = bit(1);
  b.horns(1, 0, 'Fm9', 2, 0.95); b.P.kick.note(1, 0, 'C2', 1, 0.85); b.P.snare.note(1, 0, 'D3', 1, 0.5);
  b.P.bass.note(1, 0, 'F2', 2, 0.85);
  b.hit(1, 6, 'Fm9', 6, 1);
  songs.push(b.done('sting_a'));
}
// sting_b: the sax's pickup, the riff's first three notes, into a section hit and a rimshot
{
  const b = bit(1);
  b.P.sax.line(1, 'C5:2@0.8 Eb5:2@0.85 F5:8@1');
  b.P.snare.note(1, 2, 'D3', 1, 0.3).note(1, 4, 'D3', 1, 0.45);
  b.hit(1, 6, 'Bb13', 4, 0.95);
  b.P.hat.note(1, 12, 'A5', 1, 0.5, 'ohat');
  songs.push(b.done('sting_b'));
}
// walkover: the riff while he crosses to the desk, the section in on the second time, a hit as he sits
{
  const b = bit(4);
  b.P.sax.line(1, RIFF).line(2, RIFF_2).line(3, RIFF).line(4, RIFF_2_UP);
  b.P.tpt1.line(3, RIFF);
  const plan = ['Fm9', 'Bb13', 'Fm9', 'Bb13'];
  plan.forEach((ch, i) => { b.riff(i + 1, ch, i >= 2 ? 0.9 : 0.82); b.comp(i + 1, ch, i >= 2 ? 0.5 : 0.42); b.chop(i + 1, ch); b.groove(i + 1, i >= 2 ? 1 : 0.88, i === 3); });
  for (const bar of [1, 2]) { b.horns(bar, 18, plan[bar - 1], 2, 0.9); b.horns(bar, 21, plan[bar - 1], 2, 0.8); }
  b.P.org1.note(4, 0, 'D5', ROW, 0.3); b.P.org2.note(4, 0, 'Ab4', ROW, 0.3);
  b.P.cym.note(1, 0, 'C5', 1, 0.7).note(3, 0, 'C5', 1, 0.6);
  b.hit(5, 0, 'Fm9', 8, 0.95);
  songs.push(b.done('walkover'));
}
// guest: the turn, the riff sequenced up over D♭maj9 and C7♯9, home on Fm9
{
  const b = bit(3);
  b.P.sax.line(1, TURN[0]).line(2, TURN[1]);
  b.P.tpt1.line(1, TURN[0]).line(2, TURN[1]);
  b.riff(1, 'Dbmaj9', 0.9); b.riff(2, 'C7s9', 0.9);
  b.comp(1, 'Dbmaj9'); b.comp(2, 'C7s9');
  b.chop(1, 'Dbmaj9'); b.chop(2, 'C7s9');
  b.groove(1); b.groove(2, 1, true);
  b.P.snare.roll(2, 18, 23, 'D3', 0.4, 0.9);
  b.P.cym.note(1, 0, 'C5', 1, 0.9);
  b.hit(3, 0, 'Fm9', 10);
  b.P.sax.line(3, 'C6:10@1');
  songs.push(b.done('guest'));
}
// playoff: stop-time on Fm9, the whole band climbing A♭ to C, then Fm9 and the button on four
{
  const b = bit(3);
  const HITS = 'X:3 r:5 X:2 r:2 X:3 r:3 Y:6';
  const hitLine = (n, m) => HITS.replace(/X/g, n).replace(/Y/g, m);
  b.P.sax.line(1, hitLine('Ab5', 'G5')); b.P.tpt1.line(1, hitLine('Ab5', 'G5')); b.P.tpt2.line(1, hitLine('Eb5', 'Db5')); b.P.tbn.line(1, hitLine('C5', 'Bb4'));
  b.P.bass.line(1, hitLine('F2', 'E2'));
  b.P.kick.hits(1, 'X.......X...X...........', 'C2'); b.P.snare.hits(1, 'X.......X...X.....X.....', 'D3');
  b.P.cym.note(1, 0, 'C5', 1, 0.95);
  const climb = (part, a, c, d, e, f, v = 0.9) => part.line(2, `${a}:4@${v} ${c}:4@${v + 0.02} ${d}:4@${v + 0.04} ${e}:4@${v + 0.06} ${f}:8@${v + 0.08}`);
  climb(b.P.sax, 'Ab5', 'A5', 'Bb5', 'B5', 'C6'); climb(b.P.tpt1, 'Ab5', 'A5', 'Bb5', 'B5', 'C6');
  climb(b.P.tpt2, 'Eb5', 'E5', 'F5', 'F#5', 'G5', 0.85); climb(b.P.tbn, 'C5', 'C#5', 'D5', 'D#5', 'E5', 0.85);
  climb(b.P.bass, 'Db2', 'D2', 'Eb2', 'E2', 'C2', 0.88);
  b.P.kick.hits(2, 'X...X...X...X...X.......', 'C2', 0.85);
  b.P.snare.roll(2, 0, 23, 'D3', 0.3, 1, 2);
  b.P.sax.line(3, 'F5:12@1 r:6 F5:3@1');
  b.horns(3, 0, 'Fm9', 12, 1); b.horns(3, 18, 'Fm9', 3, 1);
  b.P.bass.line(3, 'F2:12@1 r:6 F1:3@1');
  b.P.kick.note(3, 0, 'C2', 1, 1).note(3, 18, 'C2', 1, 1);
  b.P.cym.note(3, 0, 'C5', 1, 1).note(3, 18, 'C5', 1, 1);
  b.P.snare.note(3, 18, 'D3', 1, 1);
  songs.push(b.done('playoff'));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let stale = 0;
  for (const s of songs) {
    const rel = `content/audio_songs/${s.id}.json`, p = path.join(ROOT, rel), want = canonicalJson(s);
    const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (have === want) continue;
    stale++;
    if (CHECK) console.error(`✗ ${rel} is behind scripts/content/build-tonight-band.mjs`);
    else { fs.writeFileSync(p, want, 'utf8'); console.log(`  wrote ${rel}`); }
  }
  if (CHECK && stale) process.exit(1);
  for (const s of songs) {
    const rows = s.channels[0].length, notes = s.channels.reduce((n, c) => n + c.filter(Boolean).length, 0);
    console.log(`${CHECK ? '✓' : '✓ built'} ${s.name}: ${s.channels.length} channels, ${notes} notes, ${(rows / PER_BEAT * 60 / BPM).toFixed(1)} s`);
  }
}
