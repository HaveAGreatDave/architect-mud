// Expand contractions hung on a pronoun that is the OBJECT of a preposition.
//
//   node scripts/prose/object-contractions.mjs          dry run
//   node scripts/prose/object-contractions.mjs --write  apply
//
// The 2026-09-04 contractions sweep turned "is" into "'s" wherever it followed a pronoun, so
// "Everything in it is reachable" became "Everything in it's reachable" and "people like you are
// grown" became "people like you're grown". The contraction attaches to the wrong word: a reader
// parses "it's" as "it is" with "it" as the subject, and the sentence breaks. This expands them
// back. "'s been"/"'s got" are "has"; every other "'s" is "is".
//
// Edits raw bytes, so JSON key order and formatting are untouched. docs:prose carries the same
// pattern as an error rule, so it can't come back.
import fs from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');
// --skip=a,b leaves any path containing one of those fragments alone (a file another edit is holding).
const SKIP = ((process.argv.find((a) => a.startsWith('--skip=')) || '').slice(7)).split(',').filter(Boolean);
const ROOTS = ['content', 'client/game', 'plugins', 'server'];
export const OBJECT_CONTRACTION = /\b(in|of|on|to|for|with|from|at|by|about|like|than|into|onto|under|behind|inside|through|all|none|most|some) (it|you|that|this|they|we|them)('s|'re|'ll|'ve)\b(\s+(?:been|got)\b)?/gi;

const FULL = { "'re": 'are', "'ll": 'will', "'ve": 'have' };
function expand(_m, prep, pron, c, has) {
  let word;
  if (c.toLowerCase() === "'s") word = has ? 'has' : 'is';
  else word = FULL[c.toLowerCase()];
  return `${prep} ${pron} ${word}${has || ''}`;
}

function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'books' && e.name !== 'node_modules') walk(p, o); }
    else if (/\.(json|html|js|mjs)$/.test(p) && !p.endsWith('object-contractions.mjs')) o.push(p);
  }
  return o;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('object-contractions.mjs')) {
  let n = 0, files = 0;
  for (const root of ROOTS) for (const f of walk(root)) {
    if (SKIP.some((s) => f.split(path.sep).join('/').includes(s))) continue;
    const t = fs.readFileSync(f, 'utf8');
    OBJECT_CONTRACTION.lastIndex = 0;
    if (!OBJECT_CONTRACTION.test(t)) continue;
    OBJECT_CONTRACTION.lastIndex = 0;
    let k = 0;
    const out = t.replace(OBJECT_CONTRACTION, (...a) => { k++; return expand(...a); });
    n += k; files++;
    if (WRITE) fs.writeFileSync(f, out);
  }
  console.log(`${WRITE ? 'expanded' : 'would expand'} ${n} contractions in ${files} files`);
}
