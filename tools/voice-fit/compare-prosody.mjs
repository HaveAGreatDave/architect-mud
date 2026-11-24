// compare-prosody.mjs: a speaker's timing and pitch against a voice's, line for line.
//
//   node tools/voice-fit/compare-prosody.mjs <speaker prosody.json> <voice prosody.json> [segs.json]
//
// Rate is articulation rate: syllables (ORACLE's own vowel count for the line) over speech
// time less pauses. Pitch numbers are semitones over 100 Hz. Prints the medians across
// lines and, with --json, writes nothing but the summary to stdout for a sweep to read.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [, , YOU, SYN, SEGS] = process.argv;
const JSON_OUT = process.argv.includes('--json');
globalThis.window = globalThis;
for (const f of ['formant-cmudict', 'oracle-lts', 'audio-engine']) new Function(readFileSync(join(ROOT, `client/shared/${f}.js`), 'utf8'))();
const A = globalThis.AudioEngine;
const VOW = new Set(['IY','IH','EH','AE','AA','AO','UH','UW','ER','ERR','AH','AX','EY','AY','OW','OY','AW','AWC','AYC','OWC','EYC','OWR']);
const text = new Map(JSON.parse(readFileSync(SEGS, 'utf8')).map(s => [s.id, s.text]));
const syl = (id) => A._phonemesFor(text.get(id)).filter(p => VOW.has(p)).length;
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
function summary(rows) {
  return {
    rate: med(rows.map(r => syl(r.id) / Math.max(0.2, r.speech - r.pause))),
    pause: med(rows.map(r => r.pause)),
    f0med: med(rows.map(r => r.f0med)),
    range: med(rows.map(r => r.f0p90 - r.f0p10)),
    slope: med(rows.map(r => r.slope)),
    final: med(rows.map(r => r.final)),
  };
}
const you = JSON.parse(readFileSync(YOU, 'utf8')), syn = JSON.parse(readFileSync(SYN, 'utf8'));
const ids = new Set(syn.map(r => r.id));
const a = summary(you.filter(r => ids.has(r.id))), b = summary(syn);
if (JSON_OUT) { console.log(JSON.stringify({ you: a, voice: b })); process.exit(0); }
const row = (k, label, unit, d = 2) => console.log(`${label.padEnd(26)} ${a[k].toFixed(d).padStart(7)} ${b[k].toFixed(d).padStart(8)}  ${unit}`);
console.log('                              you    voice');
row('rate', 'articulation rate', 'syllables/s');
row('pause', 'pause time per line', 's');
row('f0med', 'pitch, median', 'st over 100 Hz');
row('range', 'pitch range (10-90%)', 'st');
row('slope', 'declination', 'st/s');
row('final', 'last fifth vs median', 'st');
