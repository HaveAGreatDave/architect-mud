/**
 * Contractions pass over player-facing STRINGS in the code, 2026-09-04.
 *
 * The sibling of scripts/content/contractions-pass.mjs. Same rules, different
 * corpus: the prose the engine and the client build at runtime rather than
 * read out of content/ — refusals, prompts, help text, panel copy.
 *
 * It edits string literals ONLY. Comments are left alone deliberately: this
 * repo's comments carry long "⚠ this exists because X broke" notes that other
 * sessions are editing right now, and rewriting nine thousand of them
 * mechanically would be churn across every engine file for nothing a player
 * ever reads. Run the rule over a comment when you next edit it by hand.
 *
 * Skipping comments needs a real scanner rather than a regex, for the reason
 * scripts/imports/smoke.mjs documents: a client panel is one huge template
 * literal with `//` inside URLs and apostrophes inside prose, and a regex
 * desynchronises on the first one. So this walks the file in one pass,
 * tracking string / template / comment / regex state, and rewrites only the
 * spans it knows are string bodies. Interpolations (${...}) are code.
 *
 *   node scripts/prose/contractions-code.mjs             dry run + report
 *   node scripts/prose/contractions-code.mjs --samples   dry run, show lines
 *   node scripts/prose/contractions-code.mjs --write     apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRITE = process.argv.includes('--write');
const SAMPLES = process.argv.includes('--samples');

const DIRS = ['server', 'plugins', 'client'];
const SKIP_FILE = /formant-cmudict|\.min\.js$/;

// Negatives first, exactly as the content pass orders them.
const RULES = [
  ['cannot', "can't"],
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
  ['you are', "you're"],
  ['we are', "we're"],
  ['they are', "they're"],
  ['I am', "I'm"],
  ['you will', "you'll"],
  ['it will', "it'll"],
  ['let us', "let's"],
];

const DANGLING = '(?!(?:and|but|or|nor|so|yet|because|though|although|while|until|unless)\\b)';
const cap = s => s[0].toUpperCase() + s.slice(1);
const COMPILED = RULES.flatMap(([from, to]) => {
  const tail = / not$/.test(from) || from === 'cannot' ? '(?= [A-Za-z])' : '(?= ' + DANGLING + '[A-Za-z])';
  return [
    { re: new RegExp('\\b' + from + tail, 'g'), to },
    { re: new RegExp('\\b' + cap(from) + tail, 'g'), to: cap(to) },
  ];
});

// An apostrophe inside a single-quoted literal has to be escaped; a rewrite
// that forgets this turns 'do not care' into a syntax error.
function contract(body, quote) {
  let out = body;
  for (const { re, to } of COMPILED) {
    out = out.replace(re, quote === "'" ? to.replace("'", "\\'") : to);
  }
  return out;
}

/** Rewrite the string bodies of one source file. Returns [text, count]. */
function pass(src) {
  let out = '';
  let i = 0, n = 0;
  const tmplStack = []; // depth of ${} nesting inside each open template
  while (i < src.length) {
    const c = src[i], d = src[i + 1];

    if (c === '/' && d === '/') {                         // line comment
      const e = src.indexOf('\n', i); const end = e === -1 ? src.length : e;
      out += src.slice(i, end); i = end; continue;
    }
    if (c === '/' && d === '*') {                          // block comment
      const e = src.indexOf('*/', i + 2); const end = e === -1 ? src.length : e + 2;
      out += src.slice(i, end); i = end; continue;
    }
    if (c === '"' || c === "'") {                          // quoted string
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c || src[j] === '\n') break;
        j++;
      }
      const body = src.slice(i + 1, j);
      let quote = c;
      let next = contract(body, c);
      // 'does not' -> 'doesn\'t' is correct and unreadable. Swap to double
      // quotes when the literal has no double quote of its own to trip on.
      if (quote === "'" && next !== body && !/"/.test(body) && !body.includes("\\'")) {
        quote = '"'; next = contract(body, '"');
      }
      if (next !== body) n++;
      out += quote + next + (src[j] === c ? quote : '');
      i = src[j] === c ? j + 1 : j; continue;
    }
    if (c === '`') {                                       // template literal
      let j = i + 1, chunk = '';
      out += '`';
      while (j < src.length) {
        if (src[j] === '\\') { chunk += src.slice(j, j + 2); j += 2; continue; }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') {        // interpolation: code
          const next = contract(chunk, '`');
          if (next !== chunk) n++;
          out += next; chunk = '';
          let depth = 1, k = j + 2;
          while (k < src.length && depth > 0) {
            if (src[k] === '{') depth++;
            else if (src[k] === '}') depth--;
            else if (src[k] === '"' || src[k] === "'" || src[k] === '`') {
              const q = src[k]; k++;
              while (k < src.length && src[k] !== q) { if (src[k] === '\\') k++; k++; }
            }
            k++;
          }
          const [inner, m] = pass(src.slice(j, k));        // ${...} is code
          out += inner; n += m; j = k; continue;
        }
        chunk += src[j]; j++;
      }
      const next = contract(chunk, '`');
      if (next !== chunk) n++;
      out += next + (src[j] === '`' ? '`' : '');
      i = src[j] === '`' ? j + 1 : j; continue;
    }
    out += c; i++;
  }
  return [out, n];
}

let files = 0, edits = 0;
const byDir = {}, samples = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(fp); continue; }
    if (!/\.(js|mjs)$/.test(e.name) || SKIP_FILE.test(e.name)) continue;
    const raw = fs.readFileSync(fp, 'utf8');
    const [out, n] = pass(raw);
    if (!n || out === raw) continue;
    files++; edits += n;
    const top = path.relative(ROOT, fp).split(path.sep)[0];
    byDir[top] = (byDir[top] || 0) + n;
    if (SAMPLES && samples.length < 40) {
      const a = raw.split('\n'), b = out.split('\n');
      for (let k = 0; k < a.length; k++) {
        if (a[k] !== b[k]) { samples.push([path.relative(ROOT, fp), a[k].trim().slice(0, 190), b[k].trim().slice(0, 190)]); break; }
      }
    }
    if (WRITE) fs.writeFileSync(fp, out);
  }
}

for (const d of DIRS) walk(path.join(ROOT, d));

console.log(`${WRITE ? 'Applied' : 'Would apply'} contractions in ${edits} string literals across ${files} files.`);
for (const [d, n] of Object.entries(byDir).sort((a, b) => b[1] - a[1])) console.log(`  ${d.padEnd(10)} ${n}`);
if (SAMPLES) {
  console.log('\nSamples:');
  for (const [f, a, b] of samples) { console.log('--- ' + f); console.log('  - ' + a); console.log('  + ' + b); }
}
