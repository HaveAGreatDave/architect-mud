/**
 * Contractions pass over the HTML pages, 2026-09-04. Third of three (see
 * scripts/content/contractions-pass.mjs and scripts/prose/contractions-code.mjs).
 *
 * These pages are the player guides, the tour and the client shell, so they
 * carry a lot of prose — and inline <script> blocks carrying JavaScript that
 * must not be touched by a text rewriter. So this only rewrites TEXT NODES:
 * the runs between a '>' and the next '<', with <script> and <style> skipped
 * whole. Attributes are left alone; a contraction inside one would land in a
 * quoted value with no way to know which quote it would break.
 *
 * Read/write is UTF-8 with no BOM: these files are full of ₵ ⚙ ╱ █ and a
 * re-save in the wrong encoding double-encodes the lot (see CLAUDE.md).
 *
 *   node scripts/prose/contractions-html.mjs             dry run
 *   node scripts/prose/contractions-html.mjs --write     apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRITE = process.argv.includes('--write');

const RULES = [
  ['cannot', "can't"], ['do not', "don't"], ['does not', "doesn't"], ['did not', "didn't"],
  ['is not', "isn't"], ['are not', "aren't"], ['was not', "wasn't"], ['were not', "weren't"],
  ['will not', "won't"], ['would not', "wouldn't"], ['could not', "couldn't"],
  ['should not', "shouldn't"], ['have not', "haven't"], ['has not', "hasn't"], ['had not', "hadn't"],
  ['it is', "it's"], ['that is', "that's"], ['there is', "there's"], ['what is', "what's"],
  ['you are', "you're"], ['we are', "we're"], ['they are', "they're"], ['I am', "I'm"],
  ['you will', "you'll"], ['it will', "it'll"], ['let us', "let's"],
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

function pass(src) {
  let out = '', i = 0, n = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { const [t, m] = text(src.slice(i)); out += t; n += m; break; }
    const [t, m] = text(src.slice(i, lt)); out += t; n += m;

    const tag = /^<\s*(script|style)\b/i.exec(src.slice(lt, lt + 20));
    if (tag) {                                     // skip the block whole
      const close = src.toLowerCase().indexOf('</' + tag[1].toLowerCase(), lt);
      const end = close === -1 ? src.length : src.indexOf('>', close) + 1;
      out += src.slice(lt, end); i = end; continue;
    }
    const gt = src.indexOf('>', lt);
    const end = gt === -1 ? src.length : gt + 1;
    out += src.slice(lt, end); i = end;            // the tag itself, untouched
  }
  return [out, n];
}

function text(chunk) {
  let out = chunk, n = 0;
  for (const { re, to } of COMPILED) out = out.replace(re, () => { n++; return to; });
  return [out, n];
}

let files = 0, edits = 0;
for (const dir of ['client', 'tools']) {
  const stack = [path.join(ROOT, dir)];
  while (stack.length) {
    const d = stack.pop();
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') stack.push(fp); continue; }
      if (!e.name.endsWith('.html')) continue;
      const raw = fs.readFileSync(fp, 'utf8');
      const [out, n] = pass(raw);
      if (!n || out === raw) continue;
      files++; edits += n;
      console.log(`  ${path.relative(ROOT, fp).padEnd(46)} ${n}`);
      if (WRITE) fs.writeFileSync(fp, out, 'utf8');
    }
  }
}
console.log(`${WRITE ? 'Applied' : 'Would apply'} ${edits} contractions across ${files} HTML files.`);
