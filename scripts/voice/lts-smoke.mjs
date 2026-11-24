// lts-smoke — ORACLE's letter-to-sound trees load, are used for words the lexicon lacks,
// and still say them right. The trees are built by scripts/voice/build-lts.mjs; this
// checks the built file in the tree, so a hand edit or a stale build that breaks a
// word shows here. No database, no network.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (p) => new Function(readFileSync(join(ROOT, p), 'utf8'))();
globalThis.window = globalThis;
load('client/shared/formant-cmudict.js');
load('client/shared/oracle-lts.js');
load('client/shared/audio-engine.js');
const A = globalThis.AudioEngine;

let fails = 0, n = 0;
const check = (label, cond, detail) => { n++; if (!cond) { fails++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); } };

check('the trees loaded', !!globalThis.ORACLE_LTS?.trees?.e);
check('the stress trees loaded', !!globalThis.ORACLE_LTS?.stress?.e);
const lex = new Set(globalThis.CMUDICT.blob.split('\n').map(l => l.split(' ')[0]));
// Words the lexicon lacks, each with what the trees must give (stress marks aside).
const CASES = [
  ['cyborg', 'S AY B AO R G'],
  ['nullcraft', 'N AH L K R AE F T'],
  ['wildblood', 'W AY L D B L AH D'],
  ['corvane', 'K AO R V EY N'],
  ['thornwarren', 'TH AO R N W AO R AX N'],
];
for (const [w, want] of CASES) {
  check(`"${w}" isn't in the lexicon, so it tests the trees`, !lex.has(w));
  const got = A._g2p(w).filter(p => p !== '*').join(' ');
  check(`"${w}" from the trees is ${want}`, got === want, got);
}
// The stress trees put one '*', on a full vowel.
for (const [w, want] of [['zelinsky', 'Z AX L * IH N S K IY'], ['psionics', 'SH AX N * IH K S'], ['blorptastic', 'B L AO R P T * EY S T IH K']]) {
  const got = A._g2p(w).join(' ');
  check(`"${w}" is stressed as ${want}`, got === want, got);
}
// A stressed schwa is never right: the guess moves to a full vowel.
const z = A._phonemesFor('zelinsky').join(' ');
check('"zelinsky" isn\'t stressed on a schwa', !/\* AX/.test(z), z);
// Without the trees, the rules still answer (the page before oracle-lts.js arrives).
const keep = globalThis.ORACLE_LTS; delete globalThis.ORACLE_LTS;
check('the rules answer while the trees are loading', A._g2p('cyborg').length > 3, A._g2p('cyborg').join(' '));
globalThis.ORACLE_LTS = keep;

if (fails) { console.log(`✗ lts smoke: ${fails} of ${n} failed`); process.exit(1); }
