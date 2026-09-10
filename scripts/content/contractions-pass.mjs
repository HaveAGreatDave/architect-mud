/**
 * Contractions pass, 2026-09-04.
 *
 * docs/reference/plain-writing.md now makes contractions the default, in docs
 * and in in-world prose alike. The corpus was written before that rule, almost
 * entirely uncontracted ("She does not bother to hide it"), which is what made
 * the whole game read dictated rather than spoken.
 *
 * This contracts the mechanical cases and nothing else. Every rule is a whole
 * -word match followed by a space and a letter, which is what keeps the two
 * traps out:
 *
 *   - "and you know it is."   a clause ENDING on the verb is the emphasis, and
 *                             "it's." is not English. Punctuation after the
 *                             match blocks it.
 *   - "I am NOT going"        the negatives run first, so "it is not" becomes
 *                             "it isn't" rather than "it's not"; a line that
 *                             wants the flat "I am not" keeps it by being in
 *                             the skip list below.
 *
 * Skipped on purpose:
 *   - content/books/**        public-domain literature. Not ours to edit.
 *   - Ascendant and Architect voices. Writing out is a voice tell for them in
 *     the same way em dashes are (see the carve-outs in plain-writing.md).
 *     Detected by faction, by id prefix and by filename.
 *
 * Raw substring replacement on the file BYTES, so key order and formatting are
 * untouched.
 *
 *   node scripts/content/contractions-pass.mjs             dry run + report
 *   node scripts/content/contractions-pass.mjs --write     apply
 *   node scripts/content/contractions-pass.mjs --samples   dry run, show lines
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const SAMPLES = process.argv.includes('--samples');

const SKIP_DIRS = new Set(['books']);

// Negatives first: "it is not" must land on "it isn't", never "it's not".
const RULES = [
  ['cannot', "can't"],
  ['can not', "can't"],
  ['do not', "don't"],
  ['does not', "doesn't"],
  ['did not', "didn't"],
  ['is not', "isn't"],
  ['are not', "aren't"],
  ['was not', "wasn't"],
  ['were not', "weren't"],
  ['will not', "won't"],
  ['would not', "wouldn't"],
  ['could not', "couldn't"],
  ['should not', "shouldn't"],
  ['have not', "haven't"],
  ['has not', "hasn't"],
  ['had not', "hadn't"],
  ['it is', "it's"],
  ['that is', "that's"],
  ['there is', "there's"],
  ['what is', "what's"],
  ['who is', "who's"],
  ['he is', "he's"],
  ['she is', "she's"],
  ['you are', "you're"],
  ['we are', "we're"],
  ['they are', "they're"],
  ['I am', "I'm"],
  ['I will', "I'll"],
  ['you will', "you'll"],
  ['we will', "we'll"],
  ['they will', "they'll"],
  ['he will', "he'll"],
  ['she will', "she'll"],
  ['it will', "it'll"],
  ['that will', "that'll"],
  ['let us', "let's"],
];

// A copula with no complement after it is the emphasis, and a conjunction is
// how that shows up without punctuation to catch it: "your arm stops where it
// is and will not be argued with" must never become "where it's and".
// Negatives don't need this — "does not, and" already has a comma in the way.
const DANGLING = '(?!(?:and|but|or|nor|so|yet|because|though|although|while|until|unless)\\b)';

// Case-preserving on the first letter only ("It is" -> "It's").
const cap = s => s[0].toUpperCase() + s.slice(1);
const COMPILED = RULES.flatMap(([from, to]) => {
  const tail = / not$/.test(from) || from === 'cannot' || from === 'can not'
    ? '(?= [A-Za-z])'
    : '(?= ' + DANGLING + '[A-Za-z])';
  return [
    { re: new RegExp('\\b' + from + tail, 'g'), to },
    { re: new RegExp('\\b' + cap(from) + tail, 'g'), to: cap(to) },
  ];
});

const FORMAL_RE = /ascendant|architect|\basc\b/i;
function isFormalVoice(dir, file, raw) {
  if (FORMAL_RE.test(file)) return true;
  try {
    const j = JSON.parse(raw);
    if (typeof j.faction === 'string' && /ascendant/i.test(j.faction)) return true;
    if (typeof j.id === 'string' && /^(npc_asc_|q_asc_|asc_)/.test(j.id)) return true;
  } catch { /* not an object we can read; filename check stands */ }
  return false;
}

let files = 0, edits = 0, skipped = 0;
const byDir = {}, byRule = {}, samples = [];

for (const dir of fs.readdirSync(ROOT)) {
  if (SKIP_DIRS.has(dir)) continue;
  const dp = path.join(ROOT, dir);
  if (!fs.statSync(dp).isDirectory()) continue;
  for (const file of fs.readdirSync(dp)) {
    if (!file.endsWith('.json')) continue;
    const fp = path.join(dp, file);
    const raw = fs.readFileSync(fp, 'utf8');
    let out = raw, n = 0;
    if (!COMPILED.some(c => { c.re.lastIndex = 0; return c.re.test(out); })) continue;
    if (isFormalVoice(dir, file, raw)) { skipped++; continue; }
    for (const { re, to } of COMPILED) {
      out = out.replace(re, m => {
        n++;
        byRule[m.toLowerCase()] = (byRule[m.toLowerCase()] || 0) + 1;
        return to;
      });
    }
    if (!n) continue;
    files++; edits += n;
    byDir[dir] = (byDir[dir] || 0) + n;
    if (SAMPLES && samples.length < 40) {
      const a = raw.split('\n'), b = out.split('\n');
      for (let k = 0; k < a.length; k++) {
        if (a[k] !== b[k]) { samples.push([`${dir}/${file}`, a[k].trim().slice(0, 200), b[k].trim().slice(0, 200)]); break; }
      }
    }
    if (WRITE) fs.writeFileSync(fp, out);
  }
}

console.log(`${WRITE ? 'Applied' : 'Would apply'} ${edits} contractions across ${files} files.`);
console.log(`Skipped ${skipped} files as formal voice (Ascendant / Architect) or public domain.\n`);
console.log('By directory:');
for (const [d, n] of Object.entries(byDir).sort((a, b) => b[1] - a[1])) console.log(`  ${d.padEnd(22)} ${n}`);
console.log('\nBy phrase:');
for (const [r, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${r.padEnd(14)} ${n}`);
if (SAMPLES) {
  console.log('\nSamples:');
  for (const [f, a, b] of samples) { console.log('--- ' + f); console.log('  - ' + a); console.log('  + ' + b); }
}
