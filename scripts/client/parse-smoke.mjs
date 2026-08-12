// Parse every client-side .js file, and fail if any of them is not valid JavaScript.
//
// This is the cheapest possible test and it exists because there was no build
// step: nothing between an editor and a player's browser ever PARSED these
// files. The smokes that do exist (shapes, textui, a11y, voice) import the
// specific modules they exercise, so a panel outside that set was first parsed
// on prod, by a player.
//
// The failure it was written for is the recurring one. Client panels are large
// HTML template literals, the house style writes long prose comments, and the
// house style quotes verbs in `backticks` — so a comment sitting INSIDE a
// template literal ends the string mid-sentence. In cab-view.js the word
// `horn` inside an <!-- --> note broke the whole client boot: main.js reaches
// every panel transitively, so one unparseable file means chrome and nothing
// else. No room, no vitals, no socket.
//
// The `--input-type=module < file` form is load-bearing. Plain `node --check
// <path>` parses a .js as a CommonJS script and PASSES that exact broken file;
// only the module goal reports it. Do not "simplify" this to a path argument.
//
// Run: node scripts/client/parse-smoke.mjs   (also wired into pretest:regress)
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DIR = join(ROOT, 'client');
const CONCURRENCY = 8;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// One `node --check` per file, source fed on stdin so the module goal applies.
function check(file, src) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--check', '--input-type=module'], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve(code === 0 ? null : err));
    p.stdin.end(src);
  });
}

const files = (await walk(DIR)).sort();
const failures = [];
let next = 0;

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < files.length) {
    const file = files[next++];
    const src = await readFile(file, 'utf8');
    const err = await check(file, src);
    if (err) failures.push({ file, err });
  }
}));

for (const { file, err } of failures.sort((a, b) => a.file.localeCompare(b.file))) {
  // node reports the offending line against `[stdin]`; name the real file.
  const line = err.split('\n').find((l) => /^\[stdin\]:\d+/.test(l));
  const msg = err.split('\n').find((l) => /^\w*(Syntax)?Error/.test(l)) || err.trim().split('\n')[0];
  console.error(`  ✗ ${relative(ROOT, file)}${line ? `:${line.split(':')[1]}` : ''} — ${msg}`);
}

if (failures.length) {
  console.error(`\nclient parse smoke FAILED — ${failures.length} of ${files.length} file(s) will not parse.`);
  process.exit(1);
}
console.log(`  ✓ client parse smoke — ${files.length} files parse`);
