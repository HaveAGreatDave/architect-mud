#!/usr/bin/env node
// Builds the Montreal Forced Aligner corpus and dictionary for VCTK from ORACLE's own
// pronunciations (docs/proposals/oracle-teacher.md, "Alignment onto ORACLE's phones").
//
//   node tools/voice-fit/ddsp/vctk-dict.mjs <vctk dir> <out dir>
//
// Writes, under <out dir>:
//   corpus/<speaker>/<line>.flac   hard link to the mic1 recording (no copy)
//   corpus/<speaker>/<line>.lab    the transcript, normalised to the words in the dictionary
//   oracle.dict                    MFA dictionary: word, then ARPAbet phones with stress digits
//   lines.json                     [{ id, name, text }] for export.mjs: id is a number (the twin
//                                  seeds its noise from it), name the VCTK line, text as read
//   phone-table.json               TABLE below, for vctk.py
//   oracle-pron.json               { word: [{ accent, mfa: 'K AO1 L', oracle: ['K','AO','L'] }] }
//                                  so the TextGrid reader maps MFA's phones back to ORACLE's
//
// Every word gets its GA and RP pronunciation (merged when equal); MFA picks the one that fits.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from '../synth.mjs';

const [VCTK, OUT] = process.argv.slice(2);
if (!VCTK || !OUT) { console.error('usage: vctk-dict.mjs <vctk dir> <out dir>'); process.exit(2); }

// ORACLE phone -> MFA english_us_arpa phone (no stress digit). Vowels take a digit from the
// '*' stress mark ORACLE puts before a stressed vowel. null = a marker, not a phone.
export const TABLE = {
  IY: 'IY', IH: 'IH', EH: 'EH', AE: 'AE', AA: 'AA', AO: 'AO', UH: 'UH', UW: 'UW', ER: 'ER', AH: 'AH',
  AX: 'AH',            // schwa: CMUdict writes it AH0
  ERR: 'ER',           // RP r-less NURSE/lettER
  OWR: 'OW',           // RP GOAT
  AWC: 'AW', AYC: 'AY', OWC: 'OW', EYC: 'EY',   // Canadian raising
  EY: 'EY', AY: 'AY', OY: 'OY', OW: 'OW', AW: 'AW',
  M: 'M', N: 'N', NG: 'NG', L: 'L', R: 'R', W: 'W', Y: 'Y',
  S: 'S', Z: 'Z', SH: 'SH', ZH: 'ZH', F: 'F', V: 'V', TH: 'TH', DH: 'DH',
  HH: 'HH', HA: 'HH', HE: 'HH',                 // breathy H variants
  CH: 'CH', JH: 'JH', P: 'P', B: 'B', T: 'T', D: 'D', K: 'K', G: 'G',
  TQ: 'T',             // glottal T
  DX: 'T',             // flap; MFA's ARPA model has no flap
};
const VOWELS = new Set(['IY','IH','EH','AE','AA','AO','UH','UW','ER','AH','AX','ERR','OWR','AWC','AYC','OWC','EYC','EY','AY','OY','OW','AW']);

await setup();
const A = globalThis.AudioEngine;

// The table must cover every ORACLE phone; markers start with '_'.
const missing = A._phones().filter(p => !p.startsWith('_') && !(p in TABLE));
if (missing.length) { console.error('phone table is missing: ' + missing.join(' ')); process.exit(1); }

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');

function pron(word, accent) {
  const ph = A._phonemesFor(word, { accent });
  const mfa = [], oracle = [];
  let stress = false;
  for (const p of ph) {
    if (p === '*') { stress = true; continue; }
    if (p.startsWith('_')) continue;
    const m = TABLE[p];
    if (!m) continue;
    mfa.push(VOWELS.has(p) ? m + (stress ? '1' : '0') : m);
    oracle.push(p);
    if (VOWELS.has(p)) stress = false;
  }
  return { mfa: mfa.join(' '), oracle };
}

const SKIP = new Set(['p280', 'p315']);   // p315 has no transcripts; p280's recordings have faults
const wavRoot = join(VCTK, 'wav48_silence_trimmed'), txtRoot = join(VCTK, 'txt');
const words = new Set(), lineList = [];
let lines = 0, noAudio = 0;
mkdirSync(join(OUT, 'corpus'), { recursive: true });
for (const spk of readdirSync(txtRoot).sort()) {
  if (SKIP.has(spk)) continue;
  mkdirSync(join(OUT, 'corpus', spk), { recursive: true });
  for (const f of readdirSync(join(txtRoot, spk)).filter(f => f.endsWith('.txt')).sort()) {
    const id = f.slice(0, -4);
    const flac = join(wavRoot, spk, id + '_mic1.flac');
    if (!existsSync(flac)) { noAudio++; continue; }
    const raw = readFileSync(join(txtRoot, spk, f), 'utf8').trim();
    const toks = raw.split(/\s+/).map(norm).filter(Boolean);
    if (!toks.length) continue;
    toks.forEach(t => words.add(t));
    writeFileSync(join(OUT, 'corpus', spk, id + '.lab'), toks.join(' ') + '\n');
    const dst = join(OUT, 'corpus', spk, id + '.flac');
    if (!existsSync(dst)) linkSync(flac, dst);
    lineList.push({ id: lineList.length + 1, name: id, text: raw });
    lines++;
  }
}

const dict = [], prons = {};
let empty = 0;
for (const w of [...words].sort()) {
  const vs = [];
  for (const accent of ['ga', 'rp']) {
    const p = pron(w, accent);
    if (!p.mfa) continue;
    const same = vs.find(v => v.mfa === p.mfa);
    if (same) same.accent += '+' + accent; else vs.push({ accent, ...p });
  }
  if (!vs.length) { empty++; continue; }
  prons[w] = vs;
  for (const v of vs) dict.push(`${w}\t${v.mfa}`);
}
writeFileSync(join(OUT, 'oracle.dict'), dict.join('\n') + '\n');
writeFileSync(join(OUT, 'oracle-pron.json'), JSON.stringify(prons));
writeFileSync(join(OUT, 'lines.json'), JSON.stringify(lineList));
writeFileSync(join(OUT, 'phone-table.json'), JSON.stringify(TABLE));   // vctk.py maps the trace with it
console.log(`${lines} lines, ${words.size} words, ${dict.length} pronunciations; ${noAudio} lines without mic1 audio, ${empty} words with no phones`);
