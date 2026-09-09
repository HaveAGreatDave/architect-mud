// voice suspects — which of the game's own words is the synth most likely saying wrong.
//
//   node scripts/voice/suspects.mjs [--all] [--top N]
//
// A DIAGNOSTIC, not a gate. Nothing fails; it prints a ranked list. Same shape as
// scripts/shapes survey work: a number you can re-run in a second rather than an
// opinion you have to re-argue.
//
// WHY IT EXISTS. The pronunciation table in audio-engine.js (`DICT`) carries eight
// hand-added names — cyd, echelon, kiyo, solenne, auggie, vigo, bijou, merrin —
// and each was found the same way: somebody heard it, winced, and fixed one word.
// One of the comments notes that `auggie` appears 236 times in the .bsm corpus, so
// that single error was repeating all night.
//
// After the dictionary was widened to carry the game's vocabulary, ~1,700 true
// COINAGES remain that no dictionary can help with — every invented name and place
// in the world. They all go through the letter-to-sound guesser, and nobody can
// listen to seventeen hundred words.
//
// WHAT IT LOOKS FOR. Not "is this right" — that needs an ear. It looks for output
// that is wrong on its face, using the signatures the existing DICT comments
// describe:
//
//   DOUBLED CONSONANT   `marrick` → M AA R R IH K. English has no geminates
//                       across a syllable like this; the guesser is reading a
//                       written double letter as two sounds. Always wrong. This
//                       is the "doubled the r into an err vowel" note on `merrin`.
//   SCHWA NOISE         `teodor` → T EH AX DX AX R, `myomer` → M IH AX M ER. A
//                       reduced vowel butted against another vowel is the "pure
//                       noise" the `kiyo` comment describes.
//   NO STRESS           A polysyllable with no primary stress is read flat, which
//                       is the single most robotic thing this synth can do.
//   SYLLABLE DRIFT      Phoneme vowels far off the spelling's own count means a
//                       syllable was invented or dropped — `solenne` lost one.
//
// RANKED BY HOW OFTEN IT IS SAID, because that is what made `auggie` matter and a
// name in one room's description not. Frequency is counted over the same content
// fields the voice actually reads aloud.
//
// The output is a shortlist to take to the dev panel's Voice Lab tab and
// listen to. A confirmed bad one gets a line in `DICT`.
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOP = (() => { const i = process.argv.indexOf('--top'); return i > 0 ? Number(process.argv[i + 1]) || 25 : 25; })();
const ALL = process.argv.includes('--all');

globalThis.window = globalThis;
new Function(await readFile(join(ROOT, 'client/shared/formant-cmudict.js'), 'utf8'))();
new Function(await readFile(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
const A = globalThis.AudioEngine;
if (!A?._phonemesFor) { console.error('audio-engine did not expose _phonemesFor'); process.exit(1); }

// Words the dictionary carries. Anything else reaches the guesser.
const shipped = new Set();
for (const line of globalThis.CMUDICT.blob.split('\n')) {
  const i = line.indexOf(' ');
  if (i > 0) shipped.add(line.slice(0, i));
}

// ── Harvest, with counts ─────────────────────────────────────────────────────
// The same fields the dictionary build harvests, for the same reason: Read Aloud
// speaks the whole log, so a word in room prose is a word the voice says.
const freq = new Map();
for (const kind of await readdir(join(ROOT, 'content'))) {
  let files = [];
  try { files = await readdir(join(ROOT, 'content', kind)); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let row;
    try { row = JSON.parse(await readFile(join(ROOT, 'content', kind, f), 'utf8')); } catch { continue; }
    for (const key of ['name', 'description']) {
      const v = row?.[key];
      if (typeof v !== 'string') continue;
      for (const part of v.split(/[^A-Za-z'’-]+/)) {
        const w = part.replace(/[’']s$/, '').replace(/^[-']+|[-']+$/g, '').toLowerCase();
        if (/^[a-z][a-z'-]{2,}$/.test(w)) freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
  }
}

// ── Score ────────────────────────────────────────────────────────────────────
const VOWEL = new Set(['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW','AX','ERR','OWR']);
const REDUCED = new Set(['AX', 'AH']);
// Spelling's own syllable estimate: vowel groups, less a silent final e.
const spelt = (w) => (w.replace(/e$/, '').match(/[aeiouy]+/g) || []).length || 1;

const rows = [];
for (const [word, count] of freq) {
  if (shipped.has(word)) continue;                       // the dictionary answers it
  let ph;
  try { ph = A._phonemesFor(word).filter(p => p !== '_' && p !== '!'); } catch { continue; }
  const stressed = ph.includes('*');
  const seq = ph.filter(p => p !== '*');
  if (!seq.length) continue;
  // A word already in DICT comes back correct by construction — it is not a
  // suspect, it is a word somebody already fixed. Detected rather than listed, so
  // this cannot fall out of step with the table.
  const flags = [];
  let score = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[i - 1] && !VOWEL.has(seq[i])) { flags.push(`doubled ${seq[i]}`); score += 5; break; }
  }
  // ⚠ TWO REDUCED VOWELS, not "a vowel then a schwa". The looser test flagged 53
  // words and most were CORRECT: `IY AX` is ordinary English — `sodium` is
  // S OW DX IY AX M and `media` is M IY DX IY AX, both straight out of CMUdict,
  // and every -ium/-ia/-ious word looks like that. Flagging them made the report
  // noisy, and a report nobody trusts is worth about as much as a test that always
  // passes.
  //
  // A pair of REDUCED vowels is different: nothing in English is two schwas in a
  // row. `aurelia` → AX R EH L AX AX and `fascia` → F AE S AX AX are both broken.
  for (let i = 1; i < seq.length; i++) {
    if (REDUCED.has(seq[i]) && REDUCED.has(seq[i - 1])) { flags.push(`${seq[i - 1]}+${seq[i]}`); score += 4; break; }
  }
  const vowels = seq.filter(p => VOWEL.has(p)).length;
  const syl = spelt(word);
  if (!stressed && vowels > 1) { flags.push('no stress'); score += 3; }
  if (Math.abs(vowels - syl) > 1) { flags.push(`${vowels} vowels vs ${syl} spelt`); score += 2; }
  if (!score) continue;
  // Frequency matters but must not dominate — a badly wrong word said twice still
  // beats a marginal one said forty times.
  rows.push({ word, count, score, weighted: score * (1 + Math.log10(count)), flags, ph: seq.join(' ') });
}

rows.sort((a, b) => b.weighted - a.weighted || b.count - a.count);

const guessed = [...freq.keys()].filter(w => !shipped.has(w)).length;
console.log(`${freq.size} content words · ${guessed} reach the letter-to-sound guesser · ${rows.length} look wrong on their face\n`);
const show = ALL ? rows : rows.slice(0, TOP);
for (const r of show) {
  console.log(`  ${String(r.count).padStart(4)}×  ${r.word.padEnd(16)} ${r.ph.padEnd(30)} ${r.flags.join(', ')}`);
}
if (!ALL && rows.length > show.length) console.log(`\n  …and ${rows.length - show.length} more (--all)`);
console.log('');
console.log('Audition these in the dev panel (/dev → Voice Lab). A confirmed bad one gets a line in DICT (audio-engine.js).');
